variable "subscription_id" {
  description = "The Azure subscription IRAOPS runs in."
  type        = string
}

variable "location" {
  type    = string
  default = "uaenorth"
}

# Prefix of every resource name, and the Project tag.
variable "project" {
  type    = string
  default = "iraops"
}

# 2 vCPUs and 8 GB, like the Intertec server (t3.large).
variable "vm_size" {
  type    = string
  default = "Standard_B2ms"
}

variable "disk_gb" {
  type    = number
  default = 128
}

variable "address_space" {
  type    = string
  default = "10.40.0.0/16"
}

# Public addresses (e.g. "203.0.113.7/32") allowed to Key Vault and the
# backup storage besides the server: the machine that runs Terraform and the
# settings scripts. Everything else is refused.
variable "operator_ips" {
  type    = list(string)
  default = []
}

# Who gets the server and backup alerts.
variable "notify_emails" {
  type    = list(string)
  default = []
}

variable "backup_retention_days" {
  type    = number
  default = 90
}

# The AWS account and role the server takes on with its Azure identity
# (deploy/azure/aws): images from ECR, release control, licence signing.
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_role_arn" {
  description = "Set after deploy/azure/aws is applied (its output server_role_arn). Empty: the server cannot reach AWS yet."
  type        = string
  default     = ""
}

variable "aws_release_bucket" {
  description = "The release-control bucket (deploy/azure/aws output release_bucket)."
  type        = string
  default     = ""
}
