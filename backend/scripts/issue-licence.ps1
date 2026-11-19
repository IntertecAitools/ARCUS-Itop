# Issues a real Arcus licence, signed by the production key in AWS KMS.
# Takes on the licence-issuer role with your MFA code (an authenticator app;
# a passkey works only in the console), issues the licence, records it in
# the licence register, and verifies it.
#
#   cd backend
#   powershell -ExecutionPolicy Bypass -File scripts/issue-licence.ps1 `
#     -Customer "Intertec" -Order "INTERNAL-2026" -Edition ENT -Agents 50 `
#     -Binding install:<installation id from the Licence page> -Term 1
#
# Options: -Type subscription|perpetual|evaluation|nonprod (default
# subscription), -Term 1|3|5 (subscription), -Deployment deployed|saas
# (default deployed), -ValidFrom YYYY-MM-DD (default today), -CiPacks,
# -AiPacks, -Out (default <licence id>.lic in this folder; *.lic is git-ignored).
#
# The register goes to .licence-dev/register.json on this machine; keep that
# folder (it is the record of every licence issued) and do not commit it.
param(
  [Parameter(Mandatory)] [string] $Customer,
  [Parameter(Mandatory)] [ValidateSet('ESS', 'PRO', 'ENT')] [string] $Edition,
  [Parameter(Mandatory)] [int] $Agents,
  [Parameter(Mandatory)] [ValidatePattern('^(tenant:.+|install:[0-9a-f-]{36})$')] [string] $Binding,
  [string] $Order = '',
  [ValidateSet('subscription', 'perpetual', 'evaluation', 'nonprod')] [string] $Type = 'subscription',
  [int] $Term = 1,
  [ValidateSet('deployed', 'saas')] [string] $Deployment = 'deployed',
  [string] $ValidFrom = '',
  [int] $CiPacks = 0,
  [int] $AiPacks = 0,
  [string] $Out = '',
  [string] $MfaDevice = "arn:aws:iam::557690608274:mfa/Venkatesh-HealthCareIP"
)
$ErrorActionPreference = "Stop"
$code = Read-Host "6-digit MFA code from your authenticator app"
$json = aws sts assume-role --role-arn arn:aws:iam::557690608274:role/arcus-servicedesk-licence-issuer `
  --role-session-name "licence-$env:USERNAME" --serial-number $MfaDevice --token-code $code --output json
if ($LASTEXITCODE -ne 0) { throw "Could not take on the issuer role (wrong or already used code?)." }
$c = ($json | ConvertFrom-Json).Credentials
$env:AWS_ACCESS_KEY_ID = $c.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $c.SecretAccessKey
$env:AWS_SESSION_TOKEN = $c.SessionToken
$env:AWS_REGION = "us-east-1"
$env:LICENCE_SIGNER = "kms"
$env:LICENCE_KMS_KID = "arcus-2026-1"
$env:SESSION_STORE = "memory"   # the register in .licence-dev/register.json, not a database

New-Item -ItemType Directory -Force .licence-dev | Out-Null
$cli = @('run', '--silent', 'licence', '--', 'issue', '--customer', $Customer, '--type', $Type, '--edition', $Edition,
  '--deployment', $Deployment, '--binding', $Binding, '--agents', "$Agents", '--ci-packs', "$CiPacks", '--ai-packs', "$AiPacks")
if ($Order) { $cli += @('--order', $Order) }
if ($Type -eq 'subscription') { $cli += @('--term', "$Term") }
if ($ValidFrom) { $cli += @('--valid-from', $ValidFrom) }
if ($Out) { $cli += @('--out', $Out) }
$output = & npm @cli
if ($LASTEXITCODE -ne 0) { throw "Issuing failed." }
$output | Write-Host
$file = (($output | Select-String 'Written to (.+?)(;|\.$)').Matches | Select-Object -First 1).Groups[1].Value
if (-not $file) { throw "Issued, but the file name was not in the output above: verify it with npm run licence -- verify <file>." }
npm run --silent licence -- verify $file
if ($LASTEXITCODE -ne 0) { throw "The licence did not verify." }
Write-Host "`nDone: $file is signed by the production key. Upload it on the Licence page (Administration)."
