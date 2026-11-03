# Production on AWS: one EC2 server running docker/docker-compose.prod.yml,
# behind CloudFront, deployed by CodePipeline (build -> approval -> deploy).
# deploy/aws/README.md is the guide.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # State bucket created once by deploy/aws/scripts/bootstrap-state.ps1.
  backend "s3" {
    bucket       = "arcus-servicedesk-tfstate-557690608274"
    key          = "prod/terraform.tfstate"
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
