# IRAOPS on Azure: one Linux VM running docker/docker-compose.prod.yml, behind
# Azure Front Door, with its own empty databases, secrets and backups.
# Nothing here is shared with the Intertec production on AWS.
# deploy/azure/README.md is the guide.

terraform {
  required_version = ">= 1.10"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State storage created once by deploy/azure/scripts/bootstrap-state.ps1;
  # its account name is passed at init (-backend-config=backend.hcl).
  backend "azurerm" {
    resource_group_name = "iraops-tfstate"
    container_name      = "tfstate"
    key                 = "prod.tfstate"
    use_azuread_auth    = true
  }
}

provider "azurerm" {
  subscription_id     = var.subscription_id
  storage_use_azuread = true
  features {
    key_vault {
      # Secrets are kept 90 days after deletion and the vault cannot be purged.
      purge_soft_delete_on_destroy = false
    }
    virtual_machine {
      # Never delete the disk with the databases along with the VM.
      delete_os_disk_on_deletion = false
    }
  }
}
