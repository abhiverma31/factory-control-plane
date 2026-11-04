variable "aws_region" {
  description = "AWS region where factory control-plane resources are created."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name prefix for factory control-plane resources."
  type        = string
  default     = "factory-control-plane"
}

variable "harness_image" {
  description = "Container image used by the factory harness Fargate task."
  type        = string
}