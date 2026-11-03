# Sets or changes one production setting. Secrets are typed at a hidden
# prompt, never on the command line. The next deploy applies it (or start the
# pipeline again: "Release change" in CodePipeline).
#
#   .\deploy\aws\scripts\set-setting.ps1 prod-env AWS_BEARER_TOKEN_BEDROCK -Secret
#   .\deploy\aws\scripts\set-setting.ps1 prod-env SMTP_HOST -Value smtp.office365.com
#   .\deploy\aws\scripts\set-setting.ps1 prod-env SMTP_HOST -Remove
param(
  [Parameter(Mandatory, Position = 0)] [ValidateSet('prod-env', 'itop-env')] [string] $File,
  [Parameter(Mandatory, Position = 1)] [ValidatePattern('^[A-Z][A-Z0-9_]*$')] [string] $Name,
  [string] $Value,
  [switch] $Secret,
  [switch] $Remove,
  [string] $Path = '/arcus-servicedesk/prod',
  [string] $Region = 'us-east-1'
)
$ErrorActionPreference = 'Stop'

# Values such as http://itop must be stored as text, not fetched: an AWS CLI
# config just for this script (credentials still come from your usual files).
$cfg = New-TemporaryFile
Set-Content $cfg "[default]`nregion = $Region`ncli_follow_urlparam = false"
$env:AWS_CONFIG_FILE = $cfg.FullName
$full = "$Path/$File/$Name"

if ($Remove) {
  aws ssm delete-parameter --region $Region --name $full
  Write-Host "removed $File/$Name"
  return
}

if ($Secret) {
  $sec = Read-Host "Value for $Name (hidden)" -AsSecureString
  $Value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if ([string]::IsNullOrEmpty($Value)) { throw 'Empty value: use -Remove to delete a setting.' }
$Value = $Value.Trim()
if ($Value -match "['`r`n]") { throw 'Quotes and line breaks are not allowed in a setting.' }

$type = if ($Secret) { 'SecureString' } else { 'String' }
aws ssm put-parameter --region $Region --name $full --type $type "--value=$Value" --overwrite --output text | Out-Null
if ($LASTEXITCODE -ne 0) { throw "put-parameter $full failed" }
Write-Host ("set {0}/{1}{2}. It takes effect on the next deploy." -f $File, $Name, $(if ($Secret) { ' (secret, not shown)' } else { " = $Value" }))
