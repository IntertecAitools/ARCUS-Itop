# Creates the S3 bucket that holds Terraform's state, once per AWS account.
# Private, encrypted, versioned (an older state can always be recovered).
param(
  [string] $Bucket = 'arcus-servicedesk-tfstate-557690608274',
  [string] $Region = 'us-east-1'
)
$exists = aws s3api list-buckets --query "Buckets[?Name=='$Bucket'].Name" --output text
if ($exists -eq $Bucket) { Write-Host "$Bucket exists"; return }
$ErrorActionPreference = 'Stop'

aws s3api create-bucket --bucket $Bucket --region $Region | Out-Null
aws s3api put-public-access-block --bucket $Bucket --public-access-block-configuration `
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket $Bucket --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket $Bucket --server-side-encryption-configuration `
  '{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"AES256\"}}]}'
aws s3api put-bucket-tagging --bucket $Bucket --tagging 'TagSet=[{Key=Project,Value=arcus-servicedesk}]'
Write-Host "created $Bucket"
