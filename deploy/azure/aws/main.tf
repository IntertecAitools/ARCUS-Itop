# IRAOPS: the AWS side. New resources only, all named iraops-*; nothing of
# the Intertec production (deploy/aws) is changed here. They are read:
# its images (ECR), its release bundles' presence (proof that a commit was
# built and tested), its pipeline's runs, the GitHub connection and the
# licence-signing key.
#
#  - the role the IRAOPS server takes on with its Azure identity (no keys):
#    pull images, read release control, sign licences;
#  - the release-control bucket;
#  - the "iraops-release" pipeline: a push to main -> waits for the Intertec
#    build of that commit -> manual approval "Release to IRAOPS" -> the server
#    deploys it.
#
# deploy/azure/README.md is the guide.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # The same state bucket as deploy/aws, under its own key.
  backend "s3" {
    bucket       = "arcus-servicedesk-tfstate-557690608274"
    key          = "iraops/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "iraops"
}

# The Intertec stack whose build IRAOPS releases (deploy/aws).
variable "intertec_project" {
  type    = string
  default = "arcus-servicedesk"
}

# From deploy/azure/terraform outputs.
variable "azure_tenant_id" {
  type = string
}

variable "azure_server_principal_id" {
  description = "The IRAOPS server's managed identity (terraform output server_principal_id)."
  type        = string
}

variable "github_repository" {
  type    = string
  default = "IntertecAitools/ARCUS-Itop"
}

variable "github_branch" {
  type    = string
  default = "main"
}

# Who gets the "release to IRAOPS" approval email and the failure alerts.
variable "notify_emails" {
  type    = list(string)
  default = []
}

data "aws_caller_identity" "current" {}

data "aws_ecr_repository" "app" {
  for_each = toset(["arcus-bff", "arcus-web", "arcus-itop"])
  name     = "${var.intertec_project}/${each.key}"
}

data "aws_kms_alias" "licence_signing" {
  name = "alias/arcus-licence-signing"
}

data "aws_codestarconnections_connection" "github" {
  name = "${var.intertec_project}-github"
}

locals {
  account           = data.aws_caller_identity.current.account_id
  image_base        = "${local.account}.dkr.ecr.${var.region}.amazonaws.com/${var.intertec_project}/"
  intertec_bucket   = "${var.intertec_project}-pipeline-${local.account}"
  intertec_pipeline = "${var.intertec_project}-prod"
  issuer            = "sts.windows.net/${var.azure_tenant_id}/"
  # The audience of the server's token: Azure Resource Manager (any managed
  # identity can get one); the subject (its object id) is what we trust.
  audience = "https://management.azure.com/"
}

# --- The server's role, taken on with its Azure identity.

resource "aws_iam_openid_connect_provider" "azure" {
  url            = "https://${local.issuer}"
  client_id_list = [local.audience]
  tags           = { Name = "${var.project}-azure" }
}

resource "aws_iam_role" "server" {
  name                 = "${var.project}-azure-server"
  description          = "The IRAOPS server on Azure: images, release control, licence signing."
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.azure.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.issuer}:aud" = local.audience
          "${local.issuer}:sub" = var.azure_server_principal_id
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "server" {
  name = "${var.project}-azure-server"
  role = aws_iam_role.server.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "PullImages"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:DescribeImages"]
        Resource = [for r in data.aws_ecr_repository.app : r.arn]
      },
      {
        Sid      = "ReadReleases"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${aws_s3_bucket.release.arn}/control/release.json", "${aws_s3_bucket.release.arn}/bundles/*"]
      },
      {
        Sid      = "ReportReleases"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = ["${aws_s3_bucket.release.arn}/control/status.json", "${aws_s3_bucket.release.arn}/control/logs/*"]
      },
      {
        # The operator Licences page (LICENCE_SIGNER=kms). The key's own
        # policy must name this role too (deploy/aws: licence_extra_signers).
        Sid      = "SignLicences"
        Effect   = "Allow"
        Action   = ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"]
        Resource = data.aws_kms_alias.licence_signing.target_key_arn
      },
    ]
  })
}

# --- Release control: what the pipeline approved, and what the server says.

resource "aws_s3_bucket" "release" {
  bucket        = "${var.project}-release-${local.account}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "release" {
  bucket                  = aws_s3_bucket.release.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "release" {
  bucket = aws_s3_bucket.release.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CodePipeline needs versioning on its artifact store.
resource "aws_s3_bucket_versioning" "release" {
  bucket = aws_s3_bucket.release.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "release" {
  bucket = aws_s3_bucket.release.id
  rule {
    id     = "expire-old-releases"
    status = "Enabled"
    filter {}
    expiration {
      days = 180
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# --- Notifications: approvals and failures.

resource "aws_sns_topic" "notify" {
  name = "${var.project}-notify"
}

resource "aws_sns_topic_policy" "notify" {
  arn = aws_sns_topic.notify.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AwsServicesPublish"
      Effect    = "Allow"
      Principal = { Service = ["events.amazonaws.com"] }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.notify.arn
    }]
  })
}

resource "aws_sns_topic_subscription" "email" {
  for_each  = toset(var.notify_emails)
  topic_arn = aws_sns_topic.notify.arn
  protocol  = "email"
  endpoint  = each.value
}

output "server_role_arn" {
  description = "Set as aws_role_arn in deploy/azure/terraform."
  value       = aws_iam_role.server.arn
}

output "release_bucket" {
  description = "Set as aws_release_bucket in deploy/azure/terraform."
  value       = aws_s3_bucket.release.bucket
}

output "pipeline" {
  value = aws_codepipeline.release.name
}
