output "aws_account_id" {
  description = "AWS account ID used by this Terraform configuration."
  value       = data.aws_caller_identity.current.account_id
}

output "control_plane_log_group_name" {
  description = "Name of the control-plane CloudWatch log group."
  value       = aws_cloudwatch_log_group.control_plane.name
}

output "control_plane_log_group_arn" {
  description = "ARN of the control-plane CloudWatch log group."
  value       = aws_cloudwatch_log_group.control_plane.arn
}
