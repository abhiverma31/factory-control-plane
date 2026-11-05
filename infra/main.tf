provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

data "archive_file" "control_plane" {
  type        = "zip"
  output_path = "${path.module}/control_plane.zip"

  source {
    content  = file("${path.module}/../src/control_plane/handler.py")
    filename = "handler.py"
  }

  source {
    content  = file("${path.module}/../ui/index.html")
    filename = "ui/index.html"
  }

  source {
    content  = file("${path.module}/../ui/styles.css")
    filename = "ui/styles.css"
  }

  source {
    content  = file("${path.module}/../ui/app.js")
    filename = "ui/app.js"
  }
}

data "archive_file" "worker" {
  type        = "zip"
  source_file = "${path.module}/../src/worker/handler.py"
  output_path = "${path.module}/worker.zip"
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_cloudwatch_log_group" "control_plane" {
  name              = "/aws/lambda/${var.project_name}-control-plane"
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${var.project_name}-worker"
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "harness" {
  name              = "/ecs/${var.project_name}-harness"
  retention_in_days = 3
}

resource "aws_iam_role" "control_plane_lambda" {
  name = "${var.project_name}-control-plane-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "sts:AssumeRole"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role" "worker_lambda" {
  name = "${var.project_name}-worker-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "sts:AssumeRole"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role" "harness_task_execution" {
  name = "${var.project_name}-harness-task-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "sts:AssumeRole"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role" "harness_task" {
  name = "${var.project_name}-harness-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "sts:AssumeRole"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "control_plane_lambda_logs" {
  name = "${var.project_name}-control-plane-logs"
  role = aws_iam_role.control_plane_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.control_plane.arn}:*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "worker_lambda_logs" {
  name = "${var.project_name}-worker-logs"
  role = aws_iam_role.worker_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.worker.arn}:*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "harness_task_execution" {
  role       = aws_iam_role.harness_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "harness_task_execution_secrets" {
  name = "${var.project_name}-harness-task-execution-secrets"
  role = aws_iam_role.harness_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameters"
        ]
        Resource = [
          var.github_token_parameter_arn,
          var.openai_api_key_parameter_arn
        ]
      }
    ]
  })
}

resource "aws_lambda_function" "control_plane" {
  function_name = "${var.project_name}-control-plane"
  role          = aws_iam_role.control_plane_lambda.arn
  handler       = "handler.lambda_handler"
  runtime       = "python3.12"

  filename         = data.archive_file.control_plane.output_path
  source_code_hash = data.archive_file.control_plane.output_base64sha256

  memory_size = 128
  timeout     = 10

  environment {
    variables = {
      JOBS_TABLE     = aws_dynamodb_table.jobs.name
      JOBS_QUEUE_URL = aws_sqs_queue.queue.url
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.control_plane,
    aws_iam_role_policy.control_plane_lambda_logs
  ]
}

resource "aws_lambda_function" "worker" {
  function_name = "${var.project_name}-worker"
  role          = aws_iam_role.worker_lambda.arn
  handler       = "handler.lambda_handler"
  runtime       = "python3.12"

  filename         = data.archive_file.worker.output_path
  source_code_hash = data.archive_file.worker.output_base64sha256

  memory_size = 128
  timeout     = 10

  environment {
    variables = {
      JOBS_TABLE                = aws_dynamodb_table.jobs.name
      HARNESS_CLUSTER_ARN       = aws_ecs_cluster.factory.arn
      HARNESS_TASK_DEFINITION   = aws_ecs_task_definition.harness.arn
      HARNESS_SUBNET_IDS        = join(",", data.aws_subnets.default.ids)
      HARNESS_SECURITY_GROUP_ID = aws_security_group.harness.id
      CONTROL_PLANE_URL         = aws_lambda_function_url.control_plane.function_url
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.worker,
    aws_iam_role_policy.worker_lambda_logs
  ]
}

resource "aws_lambda_function_url" "control_plane" {
  function_name      = aws_lambda_function.control_plane.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "allow_public_function_url" {
  statement_id           = "AllowPublicFunctionUrlInvoke"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.control_plane.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "allow_public_function_invoke" {
  statement_id  = "AllowPublicFunctionInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.control_plane.function_name
  principal     = "*"
}

resource "aws_sqs_queue" "queue" {
  name = "${var.project_name}-queue"

  message_retention_seconds  = 86400
  visibility_timeout_seconds = 30
}

resource "aws_ecs_cluster" "factory" {
  name = "${var.project_name}-cluster"
}

resource "aws_iam_role_policy" "control_plane_lambda_queue" {
  name = "${var.project_name}-control-plane-queue"
  role = aws_iam_role.control_plane_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.queue.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "worker_lambda_queue" {
  name = "${var.project_name}-worker-queue"
  role = aws_iam_role.worker_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.queue.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "worker_lambda_dynamodb" {
  name = "${var.project_name}-worker-dynamodb"
  role = aws_iam_role.worker_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "dynamodb:UpdateItem"
        Resource = aws_dynamodb_table.jobs.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "worker_lambda_ecs" {
  name = "${var.project_name}-worker-ecs"
  role = aws_iam_role.worker_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:RunTask"
        ]
        Resource = aws_ecs_task_definition.harness.arn
      },
      {
        Effect = "Allow"
        Action = [
          "iam:PassRole"
        ]
        Resource = [
          aws_iam_role.harness_task_execution.arn,
          aws_iam_role.harness_task.arn
        ]
      }
    ]
  })
}


resource "aws_dynamodb_table" "jobs" {
  name         = "${var.project_name}-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobId"

  attribute {
    name = "jobId"
    type = "S"
  }
}

resource "aws_iam_role_policy" "control_plane_lambda_dynamodb" {
  name = "${var.project_name}-control-plane-dynamodb"
  role = aws_iam_role.control_plane_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Scan",
          "dynamodb:UpdateItem"
        ]
        Resource = aws_dynamodb_table.jobs.arn
      }
    ]
  })
}

resource "aws_lambda_event_source_mapping" "worker_queue" {
  event_source_arn = aws_sqs_queue.queue.arn
  function_name    = aws_lambda_function.worker.arn
  batch_size       = 1
  enabled          = true
}

resource "aws_ecs_task_definition" "harness" {
  family                   = "${var.project_name}-harness"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.harness_task_execution.arn
  task_role_arn            = aws_iam_role.harness_task.arn

  container_definitions = jsonencode([
    {
      name      = "harness"
      image     = var.harness_image
      essential = true

      secrets = [
        {
          name      = "GITHUB_TOKEN"
          valueFrom = var.github_token_parameter_arn
        },
        {
          name      = "OPENAI_API_KEY"
          valueFrom = var.openai_api_key_parameter_arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.harness.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "harness"
        }
      }
    }
  ])
}

resource "aws_security_group" "harness" {
  name        = "${var.project_name}-harness"
  description = "Security group for factory harness Fargate tasks."
  vpc_id      = data.aws_vpc.default.id

  egress {
    description = "Allow outbound internet access."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecr_repository" "harness" {
  name = "${var.project_name}/harness"
}
