# --- Azure Front Door: the public HTTPS address (https://<name>.azurefd.net
# until a domain is added) in front of the server's port 8088.
#
# Nothing is cached except the frontend's hashed /assets; every other request
# goes to the server as it came. Front Door appends the viewer's address to
# X-Forwarded-For, nginx (web) appends Front Door's: TRUST_PROXY=2 in the BFF
# reads the viewer's, as on AWS.

resource "azurerm_cdn_frontdoor_profile" "main" {
  name                = "${var.project}-frontdoor"
  resource_group_name = azurerm_resource_group.main.name
  sku_name            = "Standard_AzureFrontDoor"
  # Exports and imports take minutes (nginx allows 300 s on those).
  response_timeout_seconds = 240
  tags                     = local.tags
}

resource "azurerm_cdn_frontdoor_endpoint" "app" {
  name                     = "${var.project}-${local.suffix}"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
  tags                     = local.tags
}

resource "azurerm_cdn_frontdoor_origin_group" "server" {
  name                     = "server"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
  session_affinity_enabled = false

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }

  health_probe {
    path                = "/healthz"
    protocol            = "Http"
    request_type        = "HEAD"
    interval_in_seconds = 60
  }
}

resource "azurerm_cdn_frontdoor_origin" "server" {
  name                          = "server"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.server.id
  enabled                       = true
  host_name                     = azurerm_public_ip.server.fqdn
  # The viewer's address, as CloudFront does on AWS: the app sees its own name.
  origin_host_header             = azurerm_cdn_frontdoor_endpoint.app.host_name
  http_port                      = 8088
  https_port                     = 443
  certificate_name_check_enabled = false
  priority                       = 1
  weight                         = 1000
}

resource "azurerm_cdn_frontdoor_route" "app" {
  name                          = "app"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.app.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.server.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.server.id]
  patterns_to_match             = ["/*"]
  supported_protocols           = ["Http", "Https"]
  https_redirect_enabled        = true
  forwarding_protocol           = "HttpOnly"
  link_to_default_domain        = true
}

# Vite's fingerprinted bundles: safe to cache at the edge.
resource "azurerm_cdn_frontdoor_route" "assets" {
  name                          = "assets"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.app.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.server.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.server.id]
  patterns_to_match             = ["/assets/*"]
  supported_protocols           = ["Http", "Https"]
  https_redirect_enabled        = true
  forwarding_protocol           = "HttpOnly"
  link_to_default_domain        = true

  cache {
    query_string_caching_behavior = "IgnoreQueryString"
    compression_enabled           = true
    content_types_to_compress     = ["application/javascript", "text/css", "image/svg+xml", "application/json"]
  }
}
