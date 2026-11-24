# Creates the IRAOPS production settings in Key Vault, once, before the first
# release. The server turns them into prod.env (prod--*) and itop.env
# (itop--*) on every deploy (deploy/azure/server/deploy.sh). Key Vault names
# allow no underscores: SESSION_SECRET is stored as prod--SESSION-SECRET.
#
#   .\deploy\azure\scripts\init-settings.ps1 -KeyVault (terraform -chdir=deploy/azure/terraform output -raw key_vault) `
#       -AppUrl (terraform -chdir=deploy/azure/terraform output -raw app_url) -TimeZone Asia/Dubai
#
# Passwords and secrets are generated here and never printed. A setting that
# already exists is left as it is, so running this again only adds what is
# missing. Change one later with set-setting.ps1. The product's name is not
# here: it is in deploy/azure/server/names.env.
param(
  [Parameter(Mandatory)] [string] $KeyVault,
  [Parameter(Mandatory)] [string] $AppUrl,
  [Parameter(Mandatory)] [string] $TimeZone,
  [string] $AdminLogin = 'admin'
)
$ErrorActionPreference = 'Stop'
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
foreach ($n in (az keyvault secret list --vault-name $KeyVault --query '[].name' -o tsv)) { if ($n) { $existing[$n] = $true } }

$created = 0
function Put([string] $Prefix, [string] $Name, [string] $Value, [switch] $Secret) {
  $kvName = "$Prefix--" + $Name.Replace('_', '-')
  if ($existing.ContainsKey($kvName)) { Write-Host "  kept     $Prefix/$Name"; return }
  # Through a file: values with characters the shell would read are kept as they are.
  $tmp = New-TemporaryFile
  [IO.File]::WriteAllText($tmp.FullName, $Value)
  az keyvault secret set --vault-name $KeyVault --name $kvName --file $tmp.FullName --encoding utf-8 `
    --content-type $(if ($Secret) { 'secret' } else { 'setting' }) -o none
  $code = $LASTEXITCODE
  Remove-Item $tmp.FullName -Force
  if ($code -ne 0) { throw "setting $kvName failed" }
  Write-Host ("  created  {0}/{1}{2}" -f $Prefix, $Name, $(if ($Secret) { ' (secret)' } else { '' }))
  $script:created++
}

Write-Host "prod.env (prod--*)"
$prod = [ordered]@{
  WEB_BIND = '0.0.0.0'; WEB_PORT = '8088'; COMPOSE_PROFILES = 'bundled-db'
  BACKUP_DIR = '/opt/arcus/backups'; MYSQL_IMAGE = 'mysql:8.4.13'
  ITOP_BASE_URL = 'http://itop'; ITOP_USER = 'arcus-service'; ITOP_REST_VERSION = '1.4'
  ITOP_TIMEOUT_MS = '30000'; ITOP_RETRIES = '2'; ITOP_TIMEZONE = $TimeZone
  ITOP_DEFAULT_COMMENT = 'via arcus-backend'; LOG_LEVEL = 'info'; TRUST_PROXY = '2'
  CORS_ORIGINS = $AppUrl; APP_BASE_URL = $AppUrl; LOOKUP_CACHE_TTL = '60'; AUTO_CLOSE_CHECK_MINUTES = '60'
  AUTH_REQUIRED = 'true'; SESSION_IDLE_MINUTES = '60'; SESSION_MAX_HOURS = '12'; COOKIE_SECURE = 'true'
  SESSION_STORE = 'mysql'; SESSION_DB_HOST = 'db'; SESSION_DB_PORT = '3306'
  SESSION_DB_USER = 'arcus_bff'; SESSION_DB_NAME = 'arcus_bff'
  MFA_REQUIRED = 'staff'; SSO_MFA = 'idp-or-totp'; PASSWORD_SIGN_IN = 'all'; PASSWORD_RESET_MINUTES = '30'
  # "Draft with AI" turns on once AWS_BEARER_TOKEN_BEDROCK is set (set-setting.ps1).
  RCA_AI = 'on'; RCA_AI_PROVIDER = 'bedrock'; AWS_REGION = 'us-east-1'; BEDROCK_MODEL_ID = 'anthropic.claude-sonnet-5'
  # As Intertec: multi-customer mode, licensing in warning mode, licences
  # signed in AWS KMS from the operator Licences page.
  TENANCY = 'on'; PLATFORM_LOGINS = $AdminLogin
  LICENSING = 'warn'; LICENCE_SIGNER = 'kms'; LICENCE_KMS_KID = 'arcus-2026-1'
  LICENCE_KMS_KEY_ID = 'alias/arcus-licence-signing'; LICENCE_KMS_REGION = 'us-east-1'
}
foreach ($k in $prod.Keys) { Put 'prod' $k $prod[$k] }
Put 'prod' 'ITOP_PASSWORD' (New-Secret) -Secret
Put 'prod' 'SESSION_SECRET' (New-Secret 64) -Secret
Put 'prod' 'SESSION_DB_PASSWORD' (New-Secret) -Secret

Write-Host "itop.env (itop--*)"
$itop = [ordered]@{
  ITOP_DB_HOST = 'db'; ITOP_DB_PORT = '3306'; ITOP_DB_NAME = 'itop'; ITOP_DB_USER = 'itop'
  ITOP_ADMIN_USER = $AdminLogin; ITOP_LANGUAGE = 'EN US'; ITOP_APP_ROOT_URL = 'http://localhost:8089/'
  BACKUP_TIME = '02:00'; BACKUP_KEEP_DAYS = '14'; TZ = $TimeZone
}
foreach ($k in $itop.Keys) { Put 'itop' $k $itop[$k] }
Put 'itop' 'MYSQL_ROOT_PASSWORD' (New-Secret) -Secret
Put 'itop' 'ITOP_DB_PASSWORD' (New-Secret) -Secret
Put 'itop' 'ITOP_ADMIN_PASSWORD' (New-Secret 20) -Secret

Write-Host "$created created. The administrator's password: Azure portal -> Key Vault $KeyVault -> Secrets -> itop--ITOP-ADMIN-PASSWORD -> Show secret value."
