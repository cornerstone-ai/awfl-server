# Domain ownership verification via Site Verification API
# This verifies the root domain (e.g., example.com) using a DNS TXT record managed in Cloud DNS.

# Request a DNS TXT verification token for the root domain (data source)
data "google_site_verification_token" "domain" {
  type                = "INET_DOMAIN"
  identifier          = var.root_domain
  verification_method = "DNS_TXT"

  depends_on = [
    google_project_service.siteverification, # defined in apis.tf
  ]
}

# Place the TXT token at the root domain in Cloud DNS
resource "google_dns_record_set" "root_verification_txt" {
  managed_zone = google_dns_managed_zone.root.name
  name         = "${var.root_domain}."
  type         = "TXT"
  ttl          = 300
  rrdatas      = [data.google_site_verification_token.domain.token]

  depends_on = [
    google_dns_managed_zone.root,
    google_project_service.dns,
    google_project_service.siteverification,
  ]
}

# Claim ownership once the TXT record propagates
resource "google_site_verification_web_resource" "domain" {
  site {
    type       = data.google_site_verification_token.domain.type
    identifier = data.google_site_verification_token.domain.identifier
  }

  verification_method = data.google_site_verification_token.domain.verification_method

  depends_on = [
    google_dns_record_set.root_verification_txt,
  ]
}
