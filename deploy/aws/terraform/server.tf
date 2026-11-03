# --- The server: Ubuntu 24.04 with Docker, managed through Session Manager.
# The pipeline's Deploy stage runs deploy/aws/server/deploy.sh on it.

data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

resource "aws_iam_role" "server" {
  name = "${var.project}-server"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "server_ssm" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "server_ecr" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy" "server" {
  name = "${var.project}-server"
  role = aws_iam_role.server.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReleaseBundles"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.pipeline.arn}/bundles/*"
      },
      {
        Sid      = "Backups"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.backups.arn, "${aws_s3_bucket.backups.arn}/*"]
      },
      {
        Sid      = "Settings"
        Effect   = "Allow"
        Action   = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
        Resource = "arn:aws:ssm:${var.region}:${local.account}:parameter${local.param_path}/*"
      },
      {
        Sid       = "DecryptSettings"
        Effect    = "Allow"
        Action    = ["kms:Decrypt"]
        Resource  = "*"
        Condition = { StringEquals = { "kms:ViaService" = "ssm.${var.region}.amazonaws.com" } }
      },
      {
        Sid      = "DeployLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
        Resource = "${aws_cloudwatch_log_group.deploy.arn}:*"
      },
    ]
  })
}

resource "aws_iam_instance_profile" "server" {
  name = "${var.project}-server"
  role = aws_iam_role.server.name
}

resource "aws_instance" "server" {
  ami                    = data.aws_ssm_parameter.ubuntu.value
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.server.id]
  # CloudFront's origin is this address. The account has no Elastic IPs left;
  # after a stop/start the address changes and `terraform apply` updates
  # CloudFront (a reboot keeps it).
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.server.name
  disable_api_termination     = true
  user_data = templatefile("${path.module}/user-data.sh", {
    backup_bucket = aws_s3_bucket.backups.bucket
    region        = var.region
  })

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.disk_gb
    encrypted   = true
    tags        = { Name = "${var.project}-server", Snapshot = var.project }
  }

  tags = { Name = "${var.project}-server" }

  lifecycle {
    # A newer Ubuntu image must not replace the running server.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_cloudwatch_log_group" "deploy" {
  name              = "/${var.project}/deploy"
  retention_in_days = 90
}

# --- Daily disk snapshots, 14 kept.

resource "aws_iam_role" "dlm" {
  name = "${var.project}-snapshots"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "dlm.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "snapshots" {
  description        = "${var.project} daily disk snapshots"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Snapshot = var.project }

    schedule {
      name      = "daily"
      copy_tags = true
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["23:00"]
      }
      retain_rule {
        count = 14
      }
    }
  }
}

# --- Alarm: the server stops answering AWS's health checks.

resource "aws_cloudwatch_metric_alarm" "server_status" {
  alarm_name          = "${var.project}-server-status"
  alarm_description   = "The Arcus Servicedesk server failed its EC2 status checks"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  dimensions          = { InstanceId = aws_instance.server.id }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = [aws_sns_topic.notify.arn]
  ok_actions          = [aws_sns_topic.notify.arn]
}
