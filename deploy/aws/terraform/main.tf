data "aws_caller_identity" "current" {}

locals {
  account  = data.aws_caller_identity.current.account_id
  registry = "${local.account}.dkr.ecr.${var.region}.amazonaws.com"
  # Compose image names are ${ARCUS_REGISTRY}arcus-bff etc.
  image_base = "${local.registry}/${var.project}/"
  # SSM parameters the server turns into prod.env and itop.env.
  param_path = "/${var.project}/prod"
}

# --- Network: the server's security group is the boundary. The app port
# from CloudFront only; no SSH (Session Manager).

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "server" {
  name        = "${var.project}-server"
  description = "Arcus Servicedesk: app port from CloudFront only, no SSH"
  vpc_id      = var.vpc_id

  ingress {
    description     = "App (web container) from CloudFront"
    from_port       = 8088
    to_port         = 8088
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    description = "Updates, ECR, S3, SSM, Bedrock, Microsoft 365 mail"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-server" }
}

# --- Image registry

resource "aws_ecr_repository" "app" {
  for_each             = toset(["arcus-bff", "arcus-web", "arcus-itop"])
  name                 = "${var.project}/${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 30 newest images (the rollback range)"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

# --- Buckets: backups (copied off the server nightly and before each
# deploy) and the pipeline's artifacts (release bundles).

resource "aws_s3_bucket" "backups" {
  bucket = "${var.project}-backups-${local.account}"
}

resource "aws_s3_bucket" "pipeline" {
  bucket        = "${var.project}-pipeline-${local.account}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "all" {
  for_each                = { backups = aws_s3_bucket.backups.id, pipeline = aws_s3_bucket.pipeline.id }
  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "all" {
  for_each = { backups = aws_s3_bucket.backups.id, pipeline = aws_s3_bucket.pipeline.id }
  bucket   = each.value
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "expire-old-backups"
    status = "Enabled"
    filter {}
    expiration {
      days = var.backup_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "pipeline" {
  bucket = aws_s3_bucket.pipeline.id
  rule {
    id     = "expire-artifacts"
    status = "Enabled"
    filter {}
    expiration {
      days = 180
    }
  }
}

# --- Notifications: deploy approvals, pipeline failures, server alarms.

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
      Principal = { Service = ["events.amazonaws.com", "cloudwatch.amazonaws.com"] }
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
