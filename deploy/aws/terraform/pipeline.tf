# --- CodePipeline: a push to main -> Build (tests, images to ECR, release
# bundle) -> manual Approval (email) -> Deploy (SSM Run Command on the server,
# backup first, health check, automatic rollback).

# Created PENDING: someone with GitHub admin rights on the organisation
# finishes it once in the console (Developer Tools -> Connections ->
# "Update pending connection").
resource "aws_codestarconnections_connection" "github" {
  name          = "${var.project}-github"
  provider_type = "GitHub"
}

# --- Roles

resource "aws_iam_role" "codebuild" {
  name = "${var.project}-codebuild"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "codebuild.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "codebuild" {
  name = "${var.project}-codebuild"
  role = aws_iam_role.codebuild.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.region}:${local.account}:log-group:/aws/codebuild/${var.project}-*"
      },
      {
        Sid      = "Artifacts"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:GetBucketLocation", "s3:ListBucket"]
        Resource = [aws_s3_bucket.pipeline.arn, "${aws_s3_bucket.pipeline.arn}/*"]
      },
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload",
          "ecr:DescribeImages", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload",
          "ecr:PutImage", "ecr:UploadLayerPart",
        ]
        Resource = [for r in aws_ecr_repository.app : r.arn]
      },
      {
        Sid    = "DeployToServer"
        Effect = "Allow"
        Action = ["ssm:SendCommand"]
        Resource = [
          aws_instance.server.arn,
          "arn:aws:ssm:${var.region}::document/AWS-RunShellScript",
        ]
      },
      {
        Sid      = "FollowDeploy"
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations", "ssm:DescribeInstanceInformation"]
        Resource = "*"
      },
      {
        Sid      = "DeployLog"
        Effect   = "Allow"
        Action   = ["logs:GetLogEvents", "logs:FilterLogEvents"]
        Resource = "${aws_cloudwatch_log_group.deploy.arn}:*"
      },
    ]
  })
}

resource "aws_iam_role" "codepipeline" {
  name = "${var.project}-codepipeline"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "codepipeline.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "codepipeline" {
  name = "${var.project}-codepipeline"
  role = aws_iam_role.codepipeline.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Artifacts"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:GetBucketVersioning", "s3:GetBucketLocation", "s3:ListBucket"]
        Resource = [aws_s3_bucket.pipeline.arn, "${aws_s3_bucket.pipeline.arn}/*"]
      },
      {
        Sid      = "GitHub"
        Effect   = "Allow"
        Action   = ["codestar-connections:UseConnection", "codeconnections:UseConnection"]
        Resource = aws_codestarconnections_connection.github.arn
      },
      {
        Sid      = "CodeBuild"
        Effect   = "Allow"
        Action   = ["codebuild:StartBuild", "codebuild:BatchGetBuilds"]
        Resource = [aws_codebuild_project.build.arn, aws_codebuild_project.deploy.arn]
      },
      {
        Sid      = "ApprovalEmail"
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.notify.arn
      },
    ]
  })
}

# --- Build: tests, the three images, the release bundle.

resource "aws_codebuild_project" "build" {
  name          = "${var.project}-build"
  description   = "Arcus Servicedesk: tests, images to ECR, release bundle"
  service_role  = aws_iam_role.codebuild.arn
  build_timeout = 90

  source {
    type      = "CODEPIPELINE"
    buildspec = "deploy/aws/buildspec-build.yml"
  }

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    type            = "LINUX_CONTAINER"
    compute_type    = "BUILD_GENERAL1_LARGE"
    image           = "aws/codebuild/standard:7.0"
    privileged_mode = true

    environment_variable {
      name  = "IMAGE_BASE"
      value = local.image_base
    }
    environment_variable {
      name  = "ECR_REGISTRY"
      value = local.registry
    }
    environment_variable {
      name  = "ECR_PREFIX"
      value = var.project
    }
    environment_variable {
      name  = "ARTIFACT_BUCKET"
      value = aws_s3_bucket.pipeline.bucket
    }
    environment_variable {
      name  = "VITE_APP_NAME"
      value = var.app_name
    }
    environment_variable {
      name  = "VITE_PLATFORM_NAME"
      value = var.platform_name
    }
  }

  cache {
    type  = "LOCAL"
    modes = ["LOCAL_DOCKER_LAYER_CACHE"]
  }
}

# --- Deploy: runs deploy/aws/server/deploy.sh on the server through SSM and
# follows it to the end.

resource "aws_codebuild_project" "deploy" {
  name          = "${var.project}-deploy"
  description   = "Arcus Servicedesk: deploy a built release to the production server"
  service_role  = aws_iam_role.codebuild.arn
  build_timeout = 120

  source {
    type      = "CODEPIPELINE"
    buildspec = "deploy/aws/buildspec-deploy.yml"
  }

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    type         = "LINUX_CONTAINER"
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/standard:7.0"

    environment_variable {
      name  = "INSTANCE_ID"
      value = aws_instance.server.id
    }
    environment_variable {
      name  = "IMAGE_BASE"
      value = local.image_base
    }
    environment_variable {
      name  = "ARTIFACT_BUCKET"
      value = aws_s3_bucket.pipeline.bucket
    }
    environment_variable {
      name  = "BACKUP_BUCKET"
      value = aws_s3_bucket.backups.bucket
    }
    environment_variable {
      name  = "PARAM_PATH"
      value = local.param_path
    }
    environment_variable {
      name  = "DEPLOY_LOG_GROUP"
      value = aws_cloudwatch_log_group.deploy.name
    }
  }
}

# --- The pipeline

resource "aws_codepipeline" "app" {
  name           = "${var.project}-prod"
  role_arn       = aws_iam_role.codepipeline.arn
  pipeline_type  = "V2"
  execution_mode = "QUEUED"

  artifact_store {
    type     = "S3"
    location = aws_s3_bucket.pipeline.bucket
  }

  trigger {
    provider_type = "CodeStarSourceConnection"
    git_configuration {
      source_action_name = "Source"
      push {
        branches {
          includes = [var.github_branch]
        }
      }
    }
  }

  stage {
    name = "Source"
    action {
      name             = "Source"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      namespace        = "SourceVariables"
      output_artifacts = ["source"]
      configuration = {
        ConnectionArn        = aws_codestarconnections_connection.github.arn
        FullRepositoryId     = var.github_repository
        BranchName           = var.github_branch
        OutputArtifactFormat = "CODE_ZIP"
        DetectChanges        = "true"
      }
    }
  }

  stage {
    name = "Build"
    action {
      name             = "TestAndBuild"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      version          = "1"
      namespace        = "BuildVariables"
      input_artifacts  = ["source"]
      output_artifacts = ["build"]
      configuration = {
        ProjectName = aws_codebuild_project.build.name
      }
    }
  }

  stage {
    name = "Approval"
    action {
      name     = "ApproveProductionDeploy"
      category = "Approval"
      owner    = "AWS"
      provider = "Manual"
      version  = "1"
      configuration = {
        NotificationArn    = aws_sns_topic.notify.arn
        CustomData         = "Deploy #{SourceVariables.CommitId} to production (app #{BuildVariables.APP_TAG}, iTop #{BuildVariables.ITOP_TAG}): #{SourceVariables.CommitMessage}"
        ExternalEntityLink = "https://github.com/${var.github_repository}/commit/#{SourceVariables.CommitId}"
      }
    }
  }

  stage {
    name = "Deploy"
    action {
      name            = "DeployToProduction"
      category        = "Build"
      owner           = "AWS"
      provider        = "CodeBuild"
      version         = "1"
      input_artifacts = ["source"]
      configuration = {
        ProjectName = aws_codebuild_project.deploy.name
        EnvironmentVariables = jsonencode([
          { name = "APP_TAG", value = "#{BuildVariables.APP_TAG}", type = "PLAINTEXT" },
          { name = "ITOP_TAG", value = "#{BuildVariables.ITOP_TAG}", type = "PLAINTEXT" },
        ])
      }
    }
  }
}

# A failed or stopped run emails the same list as the approvals.
resource "aws_cloudwatch_event_rule" "pipeline_failed" {
  name        = "${var.project}-pipeline-failed"
  description = "Arcus Servicedesk pipeline run failed"
  event_pattern = jsonencode({
    source        = ["aws.codepipeline"]
    "detail-type" = ["CodePipeline Pipeline Execution State Change"]
    detail = {
      pipeline = [aws_codepipeline.app.name]
      state    = ["FAILED"]
    }
  })
}

resource "aws_cloudwatch_event_target" "pipeline_failed" {
  rule = aws_cloudwatch_event_rule.pipeline_failed.name
  arn  = aws_sns_topic.notify.arn
}
