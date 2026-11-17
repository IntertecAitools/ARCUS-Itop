# Licence signing (Build Guide, sections 5 and 13): one asymmetric KMS key
# that signs Arcus licences, and the one role allowed to use it. The
# private key never leaves KMS; `npm run licence` asks KMS to sign
# (LICENCE_SIGNER=kms).
#
# Off until someone decides to create it: a routine `terraform apply` of
# this stack creates nothing here while licence_signing_enabled is false.
# To create it, set licence_signing_enabled = true and the issuer and
# custodian principals, plan, review, and apply by hand.
#
# With licence_server_signs = true as well, the server may sign too (the
# operator Licences page): set LICENCE_SIGNER=kms and LICENCE_KMS_KID in the
# server's settings.
#
# Once created, add the public key to
# backend/src/platform/licensing/sdk/public-keys.ts under a new kid (the
# output below shows the command) and ship it in a release.

variable "licence_signing_enabled" {
  description = "Create the licence-signing KMS key and the issuer role."
  type        = bool
  default     = false
}

# KMS key spec. RSA_3072 signs with RSASSA_PSS_SHA_256 (LIC-03 allows it,
# and the product verifies it). ECC_NIST_EDWARDS25519 (Ed25519) is the
# alternative where KMS offers it in our region.
variable "licence_key_spec" {
  type    = string
  default = "RSA_3072"
  validation {
    condition     = contains(["RSA_3072", "RSA_4096", "ECC_NIST_EDWARDS25519"], var.licence_key_spec)
    error_message = "licence_key_spec must be RSA_3072, RSA_4096 or ECC_NIST_EDWARDS25519."
  }
}

# Who may take on the licence-issuer role (IAM user or role ARNs of the
# licence desk). They must sign in with MFA to assume it.
variable "licence_issuer_principals" {
  type    = list(string)
  default = []
}

# Who looks after the key: the only principals that may disable it or
# schedule its deletion, and only with MFA. Name two people (or a role two
# people share under a break-glass procedure): a second person must act
# for the key to go away, and deletion always waits 30 days.
variable "licence_key_custodians" {
  type    = list(string)
  default = []
}

# Let the platform server sign too, so the operator Licences page can issue
# and renew licences (LICENCE_SIGNER=kms on the server). Off by default:
# with it on, anyone who controls the server or an operator account can
# sign licences, where otherwise only the issuer role (with MFA) can.
# Needs licence_signing_enabled.
variable "licence_server_signs" {
  description = "Allow the server's instance role to sign licences (the operator Licences page)."
  type        = bool
  default     = false
}

locals {
  licence_signing = var.licence_signing_enabled ? 1 : 0
  licence_server  = var.licence_signing_enabled && var.licence_server_signs ? 1 : 0
  licence_signers = concat(
    ["arn:aws:iam::${local.account}:role/${var.project}-licence-issuer"],
    var.licence_server_signs ? [aws_iam_role.server.arn] : [],
  )
  account_root = "arn:aws:iam::${local.account}:root"
}

resource "aws_iam_role" "licence_issuer" {
  count       = local.licence_signing
  name        = "${var.project}-licence-issuer"
  description = "Signs Arcus licences with the licence-signing KMS key. Assume only to issue licences."
  # One hour is enough to issue a batch; nobody keeps this role.
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = var.licence_issuer_principals }
      Action    = "sts:AssumeRole"
      Condition = { Bool = { "aws:MultiFactorAuthPresent" = "true" } }
    }]
  })

  lifecycle {
    precondition {
      condition     = length(var.licence_issuer_principals) > 0
      error_message = "Set licence_issuer_principals (who may issue licences) before enabling licence signing."
    }
  }
}

resource "aws_iam_role_policy" "licence_issuer" {
  count = local.licence_signing
  name  = "sign-licences"
  role  = aws_iam_role.licence_issuer[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"]
      Resource = aws_kms_key.licence_signing[0].arn
    }]
  })
}

resource "aws_kms_key" "licence_signing" {
  count                    = local.licence_signing
  description              = "Arcus licence signing (Build Guide, section 5). Private key never leaves KMS."
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = var.licence_key_spec
  deletion_window_in_days  = 30
  # Asymmetric keys cannot rotate automatically; rotation is a new key and
  # a new kid (Build Guide, section 12, "Changing the signing key").
  enable_key_rotation = false

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # The account administers the key (policy, tags, describe) but may
        # not sign with it, disable it or delete it: those are below.
        Sid       = "AccountAdministers"
        Effect    = "Allow"
        Principal = { AWS = local.account_root }
        NotAction = ["kms:Sign", "kms:ScheduleKeyDeletion", "kms:DisableKey"]
        Resource  = "*"
      },
      {
        Sid       = "IssuerSigns"
        Effect    = "Allow"
        Principal = { AWS = local.licence_signers }
        Action    = ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"]
        Resource  = "*"
      },
      {
        Sid       = "CustodiansMayRetireWithMfa"
        Effect    = "Allow"
        Principal = { AWS = length(var.licence_key_custodians) > 0 ? var.licence_key_custodians : [local.account_root] }
        Action    = ["kms:ScheduleKeyDeletion", "kms:DisableKey"]
        Resource  = "*"
        Condition = { Bool = { "aws:MultiFactorAuthPresent" = "true" } }
      },
      {
        # Belt and braces: nobody outside the custodians disables or deletes it.
        Sid       = "NobodyElseRetires"
        Effect    = "Deny"
        Principal = { AWS = "*" }
        Action    = ["kms:ScheduleKeyDeletion", "kms:DisableKey"]
        Resource  = "*"
        Condition = {
          ArnNotEquals = { "aws:PrincipalArn" = length(var.licence_key_custodians) > 0 ? var.licence_key_custodians : [local.account_root] }
        }
      },
    ]
  })

  tags = { Name = "${var.project}-licence-signing" }

  # KMS checks that every principal in the policy exists.
  depends_on = [aws_iam_role.licence_issuer]

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = length(var.licence_key_custodians) >= 2
      error_message = "Name at least two licence_key_custodians, so retiring the key needs a second person."
    }
  }
}

resource "aws_iam_role_policy" "server_signs_licences" {
  count = local.licence_server
  name  = "sign-licences"
  role  = aws_iam_role.server.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"]
      Resource = aws_kms_key.licence_signing[0].arn
    }]
  })
}

resource "aws_kms_alias" "licence_signing" {
  count         = local.licence_signing
  name          = "alias/arcus-licence-signing"
  target_key_id = aws_kms_key.licence_signing[0].key_id
}

# Tell the notify topic when anyone tries to disable or delete the key.
resource "aws_cloudwatch_event_rule" "licence_key_retire" {
  count       = local.licence_signing
  name        = "${var.project}-licence-key-retire"
  description = "Someone disabled the licence-signing key or scheduled its deletion."
  event_pattern = jsonencode({
    source        = ["aws.kms"]
    "detail-type" = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource       = ["kms.amazonaws.com"]
      eventName         = ["ScheduleKeyDeletion", "DisableKey"]
      requestParameters = { keyId = [aws_kms_key.licence_signing[0].arn, aws_kms_key.licence_signing[0].key_id] }
    }
  })
}

resource "aws_cloudwatch_event_target" "licence_key_retire" {
  count = local.licence_signing
  rule  = aws_cloudwatch_event_rule.licence_key_retire[0].name
  arn   = aws_sns_topic.notify.arn
}

output "licence_signing_key" {
  description = "The licence-signing key and how to read its public half for sdk/public-keys.ts."
  value = var.licence_signing_enabled ? {
    alias       = aws_kms_alias.licence_signing[0].name
    arn         = aws_kms_key.licence_signing[0].arn
    issuer_role = aws_iam_role.licence_issuer[0].arn
    public_key  = "aws kms get-public-key --key-id alias/arcus-licence-signing --query PublicKey --output text"
  } : null
}
