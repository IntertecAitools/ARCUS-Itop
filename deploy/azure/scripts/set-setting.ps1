# Sets or changes one IRAOPS setting in Key Vault. Secrets are typed at a
# hidden prompt, never on the command line. The next release applies it (or
# "Release change" on the iraops-release pipeline).
#
#   .\deploy\azure\scripts\set-setting.ps1 -KeyVault <vault> prod SMTP_HOST -Value smtp.office365.com
#   .\deploy\azure\scripts\set-setting.ps1 -KeyVault <vault> prod SMTP_PASSWORD -Secret
#   .\deploy\azure\scripts\set-setting.ps1 -KeyVault <vault> prod SMTP_HOST -Remove
#
# An empty value: -Value '-' (stored as "-", written to the env file as empty).
param(
  [Parameter(Mandatory)] [string] $KeyVault,
  [Parameter(Mandatory, Position = 0)] [ValidateSet('prod', 'itop')] [string] $File,
  [Parameter(Mandatory, Position = 1)] [ValidatePattern('^[A-Z][A-Z0-9_]*$')] [string] $Name,
  [string] $Value,
  [switch] $Secret,
  [switch] $Remove
)
$ErrorActionPreference = 'Stop'
$kvName = "$File--" + $Name.Replace('_', '-')

if ($Remove) {
  # Soft delete: Key Vault keeps it 90 days (recoverable).
  az keyvault secret delete --vault-name $KeyVault --name $kvName -o none
  Write-Host "removed $File/$Name"
  return
}

if ($Secret) {
  $sec = Read-Host "Value for $Name (hidden)" -AsSecureString
  $Value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if ([string]::IsNullOrEmpty($Value)) { throw 'Empty value: use -Remove to delete a setting, or -Value - for an empty one.' }
$Value = $Value.Trim()
if ($Value -match "['`r`n]") { throw 'Quotes and line breaks are not allowed in a setting.' }

$tmp = New-TemporaryFile
[IO.File]::WriteAllText($tmp.FullName, $Value)
az keyvault secret set --vault-name $KeyVault --name $kvName --file $tmp.FullName --encoding utf-8 `
  --content-type $(if ($Secret) { 'secret' } else { 'setting' }) -o none
$code = $LASTEXITCODE
Remove-Item $tmp.FullName -Force
if ($code -ne 0) { throw "setting $kvName failed" }
Write-Host ("set {0}/{1}{2}. It takes effect on the next release." -f $File, $Name, $(if ($Secret) { ' (secret, not shown)' } else { " = $Value" }))
