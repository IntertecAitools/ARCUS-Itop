variable "region" {
  type    = string
  default = "us-east-1"
}

# Prefix of every resource name, and the Project tag.
variable "project" {
  type    = string
  default = "arcus-servicedesk"
}

# The company VPC (Intertec-vpc) and its public subnet in us-east-1a. The
# private subnets have no route out, which the server needs (ECR, SSM,
# Bedrock, Microsoft 365); the security group admits only CloudFront.
variable "vpc_id" {
  type    = string
  default = "vpc-09beea2bd3d58fef5"
}

variable "subnet_id" {
  type    = string
  default = "subnet-0ed709d84a72f66c2"
}

variable "instance_type" {
  type    = string
  default = "t3.large"
}

variable "disk_gb" {
  type    = number
  default = 100
}

# GitHub repository and branch the pipeline deploys.
variable "github_repository" {
  type    = string
  default = "IntertecAitools/ARCUS-Itop"
}

variable "github_branch" {
  type    = string
  default = "main"
}

# Who gets the "approve this deploy" email and the failure alerts. Each
# address must confirm the subscription email AWS sends.
variable "notify_emails" {
  type    = list(string)
  default = []
}

# Names shown in the app, compiled into the frontend at build time.
variable "app_name" {
  type    = string
  default = "Intertec"
}

variable "platform_name" {
  type    = string
  default = "Servicedesk"
}

variable "backup_retention_days" {
  type    = number
  default = 90
}
