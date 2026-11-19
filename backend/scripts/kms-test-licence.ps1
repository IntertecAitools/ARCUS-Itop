# One-off check that the production licence key signs and that Arcus trusts
# it. Takes on the licence-issuer role with your MFA code, issues a test
# licence signed in AWS KMS, and verifies it. The licence goes to
# .licence-dev/kms-test.lic and the local register file (not the shared
# database), and binds to a made-up installation, so it unlocks nothing.
#
#   cd backend; powershell -ExecutionPolicy Bypass -File scripts/kms-test-licence.ps1
param(
  [string]$MfaDevice = "arn:aws:iam::557690608274:mfa/Venkatesh-HealthCareIP"
)
$ErrorActionPreference = "Stop"
$code = Read-Host "6-digit MFA code from your authenticator app"
$json = aws sts assume-role --role-arn arn:aws:iam::557690608274:role/arcus-servicedesk-licence-issuer `
  --role-session-name "licence-test-$env:USERNAME" --serial-number $MfaDevice --token-code $code --output json
if ($LASTEXITCODE -ne 0) { throw "Could not take on the issuer role (wrong or used code?)." }
$c = ($json | ConvertFrom-Json).Credentials
$env:AWS_ACCESS_KEY_ID = $c.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $c.SecretAccessKey
$env:AWS_SESSION_TOKEN = $c.SessionToken
$env:AWS_REGION = "us-east-1"
$env:LICENCE_SIGNER = "kms"
$env:LICENCE_KMS_KID = "arcus-2026-1"
$env:SESSION_STORE = "memory"   # register in .licence-dev/register.json, not the shared database
$out = ".licence-dev/kms-test.lic"
New-Item -ItemType Directory -Force .licence-dev | Out-Null
npm run --silent licence -- issue --customer "KMS test" --order TEST --type evaluation --edition ESS `
  --deployment deployed --binding install:00000000-0000-4000-8000-000000000000 --agents 1 --out $out
if ($LASTEXITCODE -ne 0) { throw "Issuing failed." }
npm run --silent licence -- verify $out
if ($LASTEXITCODE -ne 0) { throw "The licence did not verify." }
Write-Host "`nDone: signed in KMS (kid arcus-2026-1) and verified."
