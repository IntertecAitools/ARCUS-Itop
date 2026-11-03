output "app_url" {
  description = "The public address of the platform"
  value       = "https://${aws_cloudfront_distribution.app.domain_name}"
}

output "instance_id" {
  value = aws_instance.server.id
}

output "github_connection_arn" {
  description = "Finish it once in the console: Developer Tools -> Connections"
  value       = aws_codestarconnections_connection.github.arn
}

output "pipeline" {
  value = aws_codepipeline.app.name
}

output "param_path" {
  value = local.param_path
}

output "backup_bucket" {
  value = aws_s3_bucket.backups.bucket
}

output "image_base" {
  value = local.image_base
}
