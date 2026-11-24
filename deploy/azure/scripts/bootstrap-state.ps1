# Creates the storage that holds Terraform's state for IRAOPS on Azure, once
# per subscription: resource group iraops-tfstate, a private storage account
# (Azure AD only, no shared keys, versioned blobs) and its tfstate container.
# Writes deploy/azure/terraform/backend.hcl with the account's name.
#
#   .\deploy\azure\scripts\bootstrap-state.ps1 -SubscriptionId <id>
param(
  [Parameter(Mandatory)] [string] $SubscriptionId,
  [string] $Location = 'uaenorth',
  [string] $Group = 'iraops-tfstate'
)
$ErrorActionPreference = 'Stop'
az account set --subscription $SubscriptionId
$hcl = Join-Path $PSScriptRoot '..\terraform\backend.hcl'

$existing = $null
if ((az group exists --name $Group) -eq 'true') {
  $existing = az storage account list --resource-group $Group --query "[?starts_with(name,'iraopstfstate')].name | [0]" -o tsv
}
if ($existing) {
  Write-Host "state storage exists: $existing"
  $account = $existing
} else {
  az group create --name $Group --location $Location --tags Project=iraops ManagedBy=script -o none
  $suffix = -join ((48..57) + (97..122) | Get-Random -Count 8 | ForEach-Object { [char]$_ })
  $account = "iraopstfstate$suffix"
  az storage account create --name $account --resource-group $Group --location $Location `
    --sku Standard_ZRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false `
    --allow-shared-key-access false --tags Project=iraops -o none
  az storage account blob-service-properties update --account-name $account --resource-group $Group `
    --enable-versioning true --enable-delete-retention true --delete-retention-days 30 -o none
  $me = az ad signed-in-user show --query id -o tsv
  $scope = az storage account show --name $account --resource-group $Group --query id -o tsv
  az role assignment create --assignee-object-id $me --assignee-principal-type User `
    --role 'Storage Blob Data Contributor' --scope $scope -o none
  Write-Host 'waiting a minute for the role to apply'
  Start-Sleep -Seconds 60
  az storage container create --name tfstate --account-name $account --auth-mode login -o none
  Write-Host "created $account"
}
"storage_account_name = `"$account`"" | Set-Content -Encoding ascii $hcl
Write-Host "wrote $hcl"
