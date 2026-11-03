# --- CloudFront: the public HTTPS address (https://<id>.cloudfront.net until
# a domain is added) in front of the server's port 8088.
#
# Nothing is cached except the frontend's hashed /assets; every other request,
# with its cookies, headers and body, goes to the server as it came.
# CloudFront appends the viewer's address to X-Forwarded-For, nginx (web)
# appends CloudFront's: TRUST_PROXY=2 in the BFF reads the viewer's.

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  comment         = "${var.project} production"
  # Includes the Middle East and India edge locations.
  price_class = "PriceClass_200"

  origin {
    origin_id   = "server"
    domain_name = aws_instance.server.public_dns

    custom_origin_config {
      http_port                = 8088
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  default_cache_behavior {
    target_origin_id         = "server"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
    compress                 = true
  }

  # Vite's fingerprinted bundles: safe to cache at the edge.
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    target_origin_id       = "server"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Name = "${var.project}" }
}
