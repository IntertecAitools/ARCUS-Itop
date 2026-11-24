# --- Settings and secrets: Key Vault. The server turns them into prod.env
# and itop.env on every deploy (deploy/azure/server/deploy.sh). Secret names
# are <file>--<NAME with - for _>, e.g. prod--SESSION-SECRET.

resource "azurerm_key_vault" "main" {
  name                       = "${var.project}-kv-${local.suffix}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = true
  soft_delete_retention_days = 90
  tags                       = local.tags
}

# Whoever runs Terraform writes the settings (deploy/azure/scripts).
resource "azurerm_role_assignment" "kv_operator" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_role_assignment" "kv_server" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_virtual_machine.server.identity[0].principal_id
}

# Where the server finds AWS (its release agent and the BFF's licence signing).
resource "azurerm_key_vault_secret" "agent" {
  for_each = var.aws_role_arn == "" ? {} : {
    "agent--AWS-ROLE-ARN"       = var.aws_role_arn
    "agent--AWS-REGION"         = var.aws_region
    "agent--AWS-RELEASE-BUCKET" = var.aws_release_bucket
  }
  name         = each.key
  value        = each.value
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.kv_operator]
}

# --- Backups: copied off the server nightly and before each deploy, 90 days.

resource "azurerm_storage_account" "backups" {
  name                            = "${var.project}backups${local.suffix}"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "ZRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  https_traffic_only_enabled      = true
  tags                            = local.tags

  blob_properties {
    delete_retention_policy {
      days = 7
    }
  }
}

resource "azurerm_storage_container" "daily" {
  name                  = "daily"
  storage_account_id    = azurerm_storage_account.backups.id
  container_access_type = "private"
  depends_on            = [azurerm_role_assignment.backups_operator]
}

resource "azurerm_storage_management_policy" "backups" {
  storage_account_id = azurerm_storage_account.backups.id
  rule {
    name    = "expire-old-backups"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["daily/"]
    }
    actions {
      base_blob {
        delete_after_days_since_modification_greater_than = var.backup_retention_days
      }
    }
  }
}

resource "azurerm_role_assignment" "backups_server" {
  scope                = azurerm_storage_account.backups.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_virtual_machine.server.identity[0].principal_id
}

# Terraform creates the container with Azure AD (no shared keys).
resource "azurerm_role_assignment" "backups_operator" {
  scope                = azurerm_storage_account.backups.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}

# --- Daily disk snapshots, 14 kept (Azure Backup).

resource "azurerm_recovery_services_vault" "main" {
  name                = "${var.project}-backup-vault"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Standard"
  storage_mode_type   = "ZoneRedundant"
  tags                = local.tags
}

resource "azurerm_backup_policy_vm" "daily" {
  name                = "daily-14"
  resource_group_name = azurerm_resource_group.main.name
  recovery_vault_name = azurerm_recovery_services_vault.main.name
  timezone            = "Arabian Standard Time"

  backup {
    frequency = "Daily"
    time      = "23:00"
  }

  retention_daily {
    count = 14
  }
}

resource "azurerm_backup_protected_vm" "server" {
  resource_group_name = azurerm_resource_group.main.name
  recovery_vault_name = azurerm_recovery_services_vault.main.name
  source_vm_id        = azurerm_linux_virtual_machine.server.id
  backup_policy_id    = azurerm_backup_policy_vm.daily.id
}
