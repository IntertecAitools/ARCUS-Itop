# Creates the production settings in SSM Parameter Store, once, before the
# first deploy. The server turns them into prod.env (<path>/prod-env/*) and
# itop.env (<path>/itop-env/*) on every deploy (deploy/aws/server/deploy.sh).
#
#   .\deploy\aws\scripts\init-settings.ps1 -AppUrl https://d123.cloudfront.net -TimeZone Asia/Dubai -AdminLogin admin
#
# Passwords and secrets are generated here and stored as SecureString; they are
# never printed. A setting that already exists is left as it is, so running
# this again only adds what is missing. Change one later with set-setting.ps1.
param(
  [Parameter(Mandatory)] [string] $AppUrl,
  [Parameter(Mandatory)] [string] $TimeZone,
  [string] $AdminLogin = 'admin',
  [string] $Path = '/arcus-servicedesk/prod',
  [string] $Region = 'us-east-1'
)
$ErrorActionPreference = 'Stop'

# Values such as http://itop must be stored as text, not fetched: an AWS CLI
# config just for this script (credentials still come from your usual files).
$cfg = New-TemporaryFile
Set-Content $cfg "[default]`nregion = $Region`ncli_follow_urlparam = false"
$env:AWS_CONFIG_FILE = $cfg.FullName
$AppUrl = $AppUrl.TrimEnd('/')

# iTop's password rule: 12+ characters with upper, lower, digit and symbol.
# No quotes, $, backslash or spaces: the values go into env files.
function New-Secret([int] $Length = 32) {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.!@%+='.ToCharArray()
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  do {
    $bytes = New-Object byte[] $Length
    $rng.GetBytes($bytes)
    $s = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
  } until ($s -cmatch '[A-Z]' -and $s -cmatch '[a-z]' -and $s -match '[0-9]' -and $s -match '[-_.!@%+=]')
  $s
}

$existing = @{}
$names = aws ssm get-parameters-by-path --region $Region --path $Path --recursive --query 'Parameters[].Name' --output text
foreach ($n in ("$names" -split '\s+')) { if ($n) { $existing[$n] = $true } }

$created = 0
function Put([string] $File, [string] $Name, [string] $Value, [switch] $Secret) {
  $full = "$Path/$File/$Name"
  if ($existing.ContainsKey($full)) { Write-Host "  kept     $File/$Name"; return }
  $type = if ($Secret) { 'SecureString' } else { 'String' }
  aws ssm put-parameter --region $Region --name $full --type $type "--value=$Value" --tier Standard `
    --tags Key=Project,Value=arcus-servicedesk --output text | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "put-parameter $full failed" }
  Write-Host ("  created  {0}/{1}{2}" -f $File, $Name, $(if ($Secret) { ' (secret)' } else { '' }))
  $script:created++
}

Write-Host "prod.env ($Path/prod-env)"
$prod = [ordered]@{
  WEB_BIND = '0.0.0.0'; WEB_PORT = '8088'; COMPOSE_PROFILES = 'bundled-db'
  BACKUP_DIR = '/opt/arcus/backups'; MYSQL_IMAGE = 'public.ecr.aws/docker/library/mysql:8.4.6'
  ITOP_BASE_URL = 'http://itop'; ITOP_USER = 'arcus-service'; ITOP_REST_VERSION = '1.4'
  ITOP_TIMEOUT_MS = '30000'; ITOP_RETRIES = '2'; ITOP_TIMEZONE = $TimeZone
  ITOP_DEFAULT_COMMENT = 'via arcus-backend'; LOG_LEVEL = 'info'
  CORS_ORIGINS = $AppUrl; APP_BASE_URL = $AppUrl; LOOKUP_CACHE_TTL = '60'; AUTO_CLOSE_CHECK_MINUTES = '60'
  AUTH_REQUIRED = 'true'; SESSION_IDLE_MINUTES = '60'; SESSION_MAX_HOURS = '12'; COOKIE_SECURE = 'true'
  SESSION_STORE = 'mysql'; SESSION_DB_HOST = 'db'; SESSION_DB_PORT = '3306'
  SESSION_DB_USER = 'arcus_bff'; SESSION_DB_NAME = 'arcus_bff'
  MFA_REQUIRED = 'staff'; SSO_MFA = 'idp-or-totp'; PASSWORD_SIGN_IN = 'all'; PASSWORD_RESET_MINUTES = '30'
  # "Draft with AI" turns on once AWS_BEARER_TOKEN_BEDROCK is set (set-setting.ps1).
  RCA_AI = 'on'; RCA_AI_PROVIDER = 'bedrock'; AWS_REGION = $Region; BEDROCK_MODEL_ID = 'anthropic.claude-sonnet-5'
}
foreach ($k in $prod.Keys) { Put 'prod-env' $k $prod[$k] }
Put 'prod-env' 'ITOP_PASSWORD' (New-Secret) -Secret
Put 'prod-env' 'SESSION_SECRET' (New-Secret 64) -Secret
Put 'prod-env' 'SESSION_DB_PASSWORD' (New-Secret) -Secret

Write-Host "itop.env ($Path/itop-env)"
$itop = [ordered]@{
  ITOP_DB_HOST = 'db'; ITOP_DB_PORT = '3306'; ITOP_DB_NAME = 'itop'; ITOP_DB_USER = 'itop'
  ITOP_ADMIN_USER = $AdminLogin; ITOP_LANGUAGE = 'EN US'; ITOP_APP_ROOT_URL = 'http://localhost:8089/'
  BACKUP_TIME = '02:00'; BACKUP_KEEP_DAYS = '14'; TZ = $TimeZone
}
foreach ($k in $itop.Keys) { Put 'itop-env' $k $itop[$k] }
Put 'itop-env' 'MYSQL_ROOT_PASSWORD' (New-Secret) -Secret
Put 'itop-env' 'ITOP_DB_PASSWORD' (New-Secret) -Secret
Put 'itop-env' 'ITOP_ADMIN_PASSWORD' (New-Secret 20) -Secret

Write-Host "$created created. The administrator's password: AWS console -> Systems Manager -> Parameter Store -> $Path/itop-env/ITOP_ADMIN_PASSWORD -> Show decrypted value."
