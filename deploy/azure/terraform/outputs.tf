output "app_url" {
  description = "The IRAOPS address."
  value       = "https://${azurerm_cdn_frontdoor_endpoint.app.host_name}"
}

output "resource_group" {
  value = azurerm_resource_group.main.name
}

output "server_name" {
  value = azurerm_linux_virtual_machine.server.name
}

output "key_vault" {
  value = azurerm_key_vault.main.name
}

output "backup_account" {
  value = azurerm_storage_account.backups.name
}

# For deploy/azure/aws: the identity AWS trusts.
output "tenant_id" {
  value = data.azurerm_client_config.current.tenant_id
}

output "server_principal_id" {
  description = "The server's managed identity (the sub of its tokens)."
  value       = azurerm_linux_virtual_machine.server.identity[0].principal_id
}
