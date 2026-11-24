data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

locals {
  suffix = random_string.suffix.result
  tags = {
    Project     = var.project
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}

resource "azurerm_resource_group" "main" {
  name     = "${var.project}-prod"
  location = var.location
  tags     = local.tags
}

# --- Network: the network security group is the boundary. The app port from
# Azure Front Door only; no SSH (administration: az vm run-command).

resource "azurerm_virtual_network" "main" {
  name                = "${var.project}-vnet"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  address_space       = [var.address_space]
  tags                = local.tags
}

resource "azurerm_subnet" "server" {
  name                 = "server"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [cidrsubnet(var.address_space, 8, 1)]
}

resource "azurerm_network_security_group" "server" {
  name                = "${var.project}-server"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tags                = local.tags

  security_rule {
    name                       = "app-from-front-door"
    description                = "App (web container) from Azure Front Door"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "8088"
    source_address_prefix      = "AzureFrontDoor.Backend"
    destination_address_prefix = "*"
  }

  # Azure's own default rules allow the virtual network and its load
  # balancer; this denies everything else from outside, SSH included.
  security_rule {
    name                       = "deny-internet"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "server" {
  subnet_id                 = azurerm_subnet.server.id
  network_security_group_id = azurerm_network_security_group.server.id
}

# Front Door's origin: a fixed address with an Azure name.
resource "azurerm_public_ip" "server" {
  name                = "${var.project}-server"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  allocation_method   = "Static"
  sku                 = "Standard"
  domain_name_label   = "${var.project}-origin-${local.suffix}"
  tags                = local.tags
}

resource "azurerm_network_interface" "server" {
  name                = "${var.project}-server"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tags                = local.tags

  ip_configuration {
    name                          = "primary"
    subnet_id                     = azurerm_subnet.server.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.server.id
  }
}

# --- The server: Ubuntu 24.04 with Docker. Its managed identity reads the
# settings (Key Vault), writes backups (Storage) and takes on the AWS role.

# Azure requires an SSH key on a Linux VM. Port 22 is closed and nobody
# keeps this key: administration goes through az vm run-command.
resource "tls_private_key" "unused" {
  algorithm = "ED25519"
}

resource "azurerm_linux_virtual_machine" "server" {
  name                            = "${var.project}-server"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  size                            = var.vm_size
  admin_username                  = "iraops"
  disable_password_authentication = true
  network_interface_ids           = [azurerm_network_interface.server.id]
  encryption_at_host_enabled      = false
  secure_boot_enabled             = true
  vtpm_enabled                    = true
  tags                            = local.tags

  admin_ssh_key {
    username   = "iraops"
    public_key = tls_private_key.unused.public_key_openssh
  }

  identity {
    type = "SystemAssigned"
  }

  os_disk {
    name                 = "${var.project}-server-os"
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = var.disk_gb
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  custom_data = base64encode(templatefile("${path.module}/cloud-init.sh", {
    key_vault      = azurerm_key_vault.main.name
    backup_account = azurerm_storage_account.backups.name
    # The release agent's first copy; every release brings its own after that.
    release_agent_b64 = filebase64("${path.module}/../server/release-agent.sh")
  }))

  lifecycle {
    # A newer Ubuntu image or a changed first-boot script must not replace the running server.
    ignore_changes = [source_image_reference, custom_data]
  }
}

# --- Alerts

resource "azurerm_monitor_action_group" "notify" {
  name                = "${var.project}-notify"
  resource_group_name = azurerm_resource_group.main.name
  short_name          = "iraops"
  tags                = local.tags

  dynamic "email_receiver" {
    for_each = var.notify_emails
    content {
      name                    = "email-${email_receiver.key}"
      email_address           = email_receiver.value
      use_common_alert_schema = true
    }
  }
}

resource "azurerm_monitor_metric_alert" "server_available" {
  name                = "${var.project}-server-available"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_linux_virtual_machine.server.id]
  description         = "The IRAOPS server is not available"
  frequency           = "PT5M"
  window_size         = "PT15M"
  severity            = 1
  tags                = local.tags

  criteria {
    metric_namespace = "Microsoft.Compute/virtualMachines"
    metric_name      = "VmAvailabilityMetric"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 1
  }

  action {
    action_group_id = azurerm_monitor_action_group.notify.id
  }
}
