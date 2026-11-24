# --- The "iraops-release" pipeline. Built once: it never builds images. It
# waits for the Intertec pipeline to build and test the same commit, then asks
# for its own approval, then hands the release to the IRAOPS server.

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
        Sid      = "ReleaseBucket"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:GetBucketLocation", "s3:ListBucket"]
        Resource = [aws_s3_bucket.release.arn, "${aws_s3_bucket.release.arn}/*"]
      },
      {
        # Read only: has the Intertec build of this commit finished?
        Sid      = "IntertecBundles"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "arn:aws:s3:::${local.intertec_bucket}/bundles/*"
      },
      {
        Sid       = "IntertecBundlesList"
        Effect    = "Allow"
        Action    = ["s3:ListBucket"]
        Resource  = "arn:aws:s3:::${local.intertec_bucket}"
        Condition = { StringLike = { "s3:prefix" = ["bundles/*"] } }
      },
      {
        Sid      = "IntertecRuns"
        Effect   = "Allow"
        Action   = ["codepipeline:ListPipelineExecutions", "codepipeline:ListActionExecutions"]
        Resource = "arn:aws:codepipeline:${var.region}:${local.account}:${local.intertec_pipeline}"
      },
      {
        Sid      = "Images"
        Effect   = "Allow"
        Action   = ["ecr:DescribeImages"]
        Resource = [for r in data.aws_ecr_repository.app : r.arn]
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
        Resource = [aws_s3_bucket.release.arn, "${aws_s3_bucket.release.arn}/*"]
      },
      {
        Sid      = "GitHub"
        Effect   = "Allow"
        Action   = ["codestar-connections:UseConnection", "codeconnections:UseConnection"]
        Resource = data.aws_codestarconnections_connection.github.arn
      },
      {
        Sid      = "CodeBuild"
        Effect   = "Allow"
        Action   = ["codebuild:StartBuild", "codebuild:BatchGetBuilds"]
        Resource = [aws_codebuild_project.prepare.arn, aws_codebuild_project.release.arn]
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

locals {
  codebuild_env = {
    RELEASE_BUCKET    = aws_s3_bucket.release.bucket
    INTERTEC_BUCKET   = local.intertec_bucket
    INTERTEC_PIPELINE = local.intertec_pipeline
    ECR_PREFIX        = var.intertec_project
    IMAGE_BASE        = local.image_base
  }
}

resource "aws_codebuild_project" "prepare" {
  name          = "${var.project}-prepare"
  description   = "IRAOPS: wait for the Intertec build of this commit, package the IRAOPS release"
  service_role  = aws_iam_role.codebuild.arn
  build_timeout = 120

  source {
    type      = "CODEPIPELINE"
    buildspec = "deploy/azure/pipeline/buildspec-prepare.yml"
  }

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    type         = "LINUX_CONTAINER"
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/standard:7.0"
    dynamic "environment_variable" {
      for_each = local.codebuild_env
      content {
        name  = environment_variable.key
        value = environment_variable.value
      }
    }
  }
}

resource "aws_codebuild_project" "release" {
  name          = "${var.project}-release"
  description   = "IRAOPS: hand an approved release to the server on Azure and follow it"
  service_role  = aws_iam_role.codebuild.arn
  build_timeout = 120

  source {
    type      = "CODEPIPELINE"
    buildspec = "deploy/azure/pipeline/buildspec-release.yml"
  }

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    type         = "LINUX_CONTAINER"
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/standard:7.0"
    dynamic "environment_variable" {
      for_each = local.codebuild_env
      content {
        name  = environment_variable.key
        value = environment_variable.value
      }
    }
  }
}

resource "aws_codepipeline" "release" {
  name           = "${var.project}-release"
  role_arn       = aws_iam_role.codepipeline.arn
  pipeline_type  = "V2"
  execution_mode = "QUEUED"

  artifact_store {
    type     = "S3"
    location = aws_s3_bucket.release.bucket
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
        ConnectionArn        = data.aws_codestarconnections_connection.github.arn
        FullRepositoryId     = var.github_repository
        BranchName           = var.github_branch
        OutputArtifactFormat = "CODE_ZIP"
        DetectChanges        = "true"
      }
    }
  }

  stage {
    name = "WaitForBuild"
    action {
      name            = "WaitForIntertecBuild"
      category        = "Build"
      owner           = "AWS"
      provider        = "CodeBuild"
      version         = "1"
      namespace       = "BuildVariables"
      input_artifacts = ["source"]
      configuration = {
        ProjectName = aws_codebuild_project.prepare.name
      }
    }
  }

  stage {
    name = "Approval"
    action {
      name     = "ReleaseToIRAOPS"
      category = "Approval"
      owner    = "AWS"
      provider = "Manual"
      version  = "1"
      configuration = {
        NotificationArn    = aws_sns_topic.notify.arn
        CustomData         = "Release #{SourceVariables.CommitId} to IRAOPS on Azure (app #{BuildVariables.APP_TAG}, iTop #{BuildVariables.ITOP_TAG}): #{SourceVariables.CommitMessage}"
        ExternalEntityLink = "https://github.com/${var.github_repository}/commit/#{SourceVariables.CommitId}"
      }
    }
  }

  stage {
    name = "Release"
    action {
      name            = "DeployToIRAOPS"
      category        = "Build"
      owner           = "AWS"
      provider        = "CodeBuild"
      version         = "1"
      input_artifacts = ["source"]
      configuration = {
        ProjectName = aws_codebuild_project.release.name
        EnvironmentVariables = jsonencode([
          { name = "APP_TAG", value = "#{BuildVariables.APP_TAG}", type = "PLAINTEXT" },
          { name = "ITOP_TAG", value = "#{BuildVariables.ITOP_TAG}", type = "PLAINTEXT" },
        ])
      }
    }
  }
}

resource "aws_cloudwatch_event_rule" "pipeline_failed" {
  name        = "${var.project}-pipeline-failed"
  description = "IRAOPS release pipeline run failed"
  event_pattern = jsonencode({
    source        = ["aws.codepipeline"]
    "detail-type" = ["CodePipeline Pipeline Execution State Change"]
    detail = {
      pipeline = [aws_codepipeline.release.name]
      state    = ["FAILED"]
    }
  })
}

resource "aws_cloudwatch_event_target" "pipeline_failed" {
  rule = aws_cloudwatch_event_rule.pipeline_failed.name
  arn  = aws_sns_topic.notify.arn
}
