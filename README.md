# Factory Control Plane

Serverless job control plane for software factory runs.

This repository is a standalone prototype control plane. It is separate from any target application repository. The control plane owns job intake, state, queue dispatch, lifecycle events, and basic run visibility.

It does not own agent reasoning, code-editing behavior, tool choices, or workflow instructions. Those belong later in the worker, harness, sandbox, or agent layer.

## Current Shape

The current v0 is intentionally small:

- A control-plane Lambda exposed through a Lambda Function URL
- A worker Lambda triggered by SQS
- A DynamoDB table for job records and embedded lifecycle events
- An SQS queue for dispatching jobs from the control plane to the worker
- CloudWatch log groups with short retention
- A small static UI served by the control-plane Lambda
- Terraform-managed infrastructure

There is no API Gateway, ECS, EC2, RDS, NAT Gateway, VPC, SAM, or CDK.

## Flow

```mermaid
flowchart LR
    client[Browser / API client]
    control[control-plane Lambda]
    queue[SQS queue]
    worker[worker Lambda]
    db[(DynamoDB jobs table)]

    client -- "POST /jobs" --> control
    control -- "1. write SUBMITTED event" --> db
    control -- "2. update status to QUEUED" --> db
    control -- "3. send job message" --> queue
    queue -- "triggers" --> worker
    worker -- "4. update status to PICKED_UP" --> db
```

For a submitted job, the current lifecycle is:

```text
POST /jobs
  │
  ▼
SUBMITTED  - control plane accepted and stored the job
  │
  ▼
QUEUED     - control plane sent the job message to SQS
  │
  ▼
PICKED_UP  - worker Lambda received the SQS message
```

The worker currently only proves that it received the job from SQS. It does not perform real software-factory work yet.

## API

The same Lambda Function URL serves both the UI and JSON API.

### UI

```http
GET /
GET /index.html
GET /styles.css
GET /app.js
```

### Health

```http
GET /health
```

Returns:

```json
{"ok": true}
```

### Workflows

```http
GET /workflows
```

Returns the currently accepted workflow labels:

```json
{
  "workflows": [
    {
      "workflowId": "feature-development",
      "name": "Feature development"
    },
    {
      "workflowId": "incident-investigation",
      "name": "Incident investigation"
    }
  ]
}
```

These workflow IDs are routing/category labels only. They do not specify tools, prompts, shell behavior, Git behavior, or test behavior.

### Create Job

```http
POST /jobs
```

Example request:

```json
{
  "workflowId": "feature-development",
  "title": "Add registration validation",
  "description": "Validate phone number during customer registration"
}
```

The control plane validates the request, writes a DynamoDB job record, sends a message to SQS, and records lifecycle events.

### List Jobs

```http
GET /jobs
```

Returns job summaries and counts for the UI board.

### Get Job

```http
GET /jobs/{jobId}
```

Returns the full job record.

### Get Job Events

```http
GET /jobs/{jobId}/events
```

Returns the lifecycle event timeline for a job.

## Repository Layout

```text
infra/
  main.tf
  outputs.tf
  variables.tf
  versions.tf

src/
  control_plane/
    handler.py
  worker/
    handler.py

ui/
  index.html
  styles.css
  app.js
```

## Deploy

From the repository root:

```sh
terraform -chdir=infra init
terraform -chdir=infra plan
terraform -chdir=infra apply
```

Terraform packages the Lambda code and static UI into zip files locally, then updates AWS.

## Smoke Tests

Set the Function URL after deploy:

```sh
BASE_URL="https://your-function-url.lambda-url.us-east-1.on.aws"
```

Health:

```sh
curl "$BASE_URL/health"
```

Workflows:

```sh
curl "$BASE_URL/workflows"
```

Create a job:

```sh
curl -X POST "$BASE_URL/jobs" \
  -H 'content-type: application/json' \
  -d '{
    "workflowId": "feature-development",
    "title": "Queue smoke test",
    "description": "Confirm control plane stores and dispatches a job"
  }'
```

List jobs:

```sh
curl "$BASE_URL/jobs"
```

Open the UI:

```text
https://your-function-url.lambda-url.us-east-1.on.aws/
```

## Local Checks

Python syntax:

```sh
python3 -m py_compile src/control_plane/handler.py src/worker/handler.py
```

JavaScript syntax:

```sh
node --check ui/app.js
```

Terraform formatting:

```sh
terraform fmt -recursive
```

## Notes

- DynamoDB is the source of truth for job state and event history.
- SQS is the dispatch buffer between the control plane and worker.
- The UI is currently served by the control-plane Lambda for prototype simplicity.
- Longer term, the UI can move to S3/CloudFront and the control plane can remain API-only.
- Terraform state files and generated zip files should not be committed.
