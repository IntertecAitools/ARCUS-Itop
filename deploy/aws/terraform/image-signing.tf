# Image signing (SEC-05): one asymmetric KMS key the build signs the images
# with (cosign), and the server checks the signatures with before it starts
# a release. The private key never leaves KMS; the server may only read the
# public key, so it can check signatures but never make them.
#
# Off until someone decides to turn it on: while image_signing_enabled is
# false, applying this stack creates and changes nothing here. To turn it on,
# set image_signing_enabled = true, plan, review and apply by hand. The next
# pipeline run then signs the three images, and its deploy checks them.
# deploy/aws/README.md, "Image signing", has the steps and the rollback note.

variable "image_signing_enabled" {
  description = "Create the image-signing KMS key; the build signs the images and the server refuses unsigned ones."
  type        = bool
  default     = false
}

locals {
  image_signing       = var.image_signing_enabled ? 1 : 0
  image_signing_alias = "alias/${var.project}-image-signing"
  # What cosign is given (CodeBuild's IMAGE_SIGNING_KEY); empty when off.
  image_signing_key = var.image_signing_enabled ? "awskms:///${local.image_signing_alias}" : ""
  # Each signature is stored in ECR next to its image and counts towards the
  # repository's keep-30 rule: keep twice as many so the rollback range holds.
  ecr_keep_images = var.image_signing_enabled ? 60 : 30
}

resource "aws_kms_key" "image_signing" {
  count                    = local.image_signing
  description              = "Arcus Servicedesk image signing (cosign, SEC-05). Private key never leaves KMS."
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_NIST_P256"
  deletion_window_in_days  = 30
  # Asymmetric keys cannot rotate automatically. A new key means re-signing
  # the images in the rollback range (deploy/aws/README.md).
  enable_key_rotation = false

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # The account administers the key but does not sign with it: only
        # the build does.
        Sid       = "AccountAdministers"
        Effect    = "Allow"
        Principal = { AWS = local.account_root }
        NotAction = ["kms:Sign"]
        Resource  = "*"
      },
      {
        Sid       = "BuildSigns"
        Effect    = "Allow"
        Principal = { AWS = aws_iam_role.codebuild.arn }
        Action    = ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"]
        Resource  = "*"
      },
      {
        Sid       = "ServerChecks"
        Effect    = "Allow"
        Principal = { AWS = aws_iam_role.server.arn }
        Action    = ["kms:GetPublicKey", "kms:DescribeKey", "kms:Verify"]
        Resource  = "*"
      },
    ]
  })

  tags = { Name = "${var.project}-image-signing" }
}

resource "aws_kms_alias" "image_signing" {
  count         = local.image_signing
  name          = local.image_signing_alias
  target_key_id = aws_kms_key.image_signing[0].key_id
}

resource "aws_iam_role_policy" "codebuild_signs_images" {
  count = local.image_signing
  name  = "sign-images"
  role  = aws_iam_role.codebuild.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"]
      Resource = aws_kms_key.image_signing[0].arn
    }]
  })
}

resource "aws_iam_role_policy" "server_checks_images" {
  count = local.image_signing
  name  = "check-image-signatures"
  role  = aws_iam_role.server.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:GetPublicKey", "kms:DescribeKey", "kms:Verify"]
      Resource = aws_kms_key.image_signing[0].arn
    }]
  })
}

output "image_signing_key" {
  description = "The cosign key reference the build signs with and the server checks with (empty while image signing is off)."
  value       = local.image_signing_key
}
