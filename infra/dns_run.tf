# Cloud DNS public zone for the root domain
resource "google_dns_managed_zone" "root" {
  name        = replace(var.root_domain, ".", "-")
  dns_name    = "${var.root_domain}."
  description = "Public DNS zone for ${var.root_domain}"

  # Ensure the Cloud DNS API is enabled before creating the zone
  depends_on = [google_project_service.dns]
}

output "dns_nameservers" {
  description = "Name servers for the Cloud DNS public zone; set these at your domain registrar"
  value       = google_dns_managed_zone.root.name_servers
}

# ------------------------------
# Cloud Run domain mappings (no external load balancer)
# ------------------------------

# Map api.<root_domain> to Cloud Run service "api"
resource "google_cloud_run_domain_mapping" "api" {
  count    = var.cloud_run_services_exist ? 1 : 0
  provider = google-beta
  location = var.region
  name     = "api.${var.root_domain}"

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = "api"
  }

  # Ensure required APIs are enabled first and domain is verified
  depends_on = [
    google_project_service.run,
    google_project_service.certman,
    google_site_verification_web_resource.domain,
  ]
}

# Map jobs.<root_domain> to Cloud Run service "jobs"
resource "google_cloud_run_domain_mapping" "jobs" {
  count    = var.cloud_run_services_exist ? 1 : 0
  provider = google-beta
  location = var.region
  name     = "jobs.${var.root_domain}"

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = "jobs"
  }

  # Ensure required APIs are enabled first and domain is verified
  depends_on = [
    google_project_service.run,
    google_project_service.certman,
    google_site_verification_web_resource.domain,
  ]
}

# ------------------------------
# DNS records for Cloud Run domain mappings
# For subdomains, Cloud Run requires a CNAME to ghs.googlehosted.com.
# Use static records; create them only when services exist and mappings are enabled.
# ------------------------------

resource "google_dns_record_set" "api_cname" {
  count        = var.cloud_run_services_exist ? 1 : 0
  managed_zone = google_dns_managed_zone.root.name
  name         = "api.${var.root_domain}."
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["ghs.googlehosted.com."]

  depends_on = [
    google_dns_managed_zone.root,
    google_project_service.dns,
    google_cloud_run_domain_mapping.api,
  ]
}

resource "google_dns_record_set" "jobs_cname" {
  count        = var.cloud_run_services_exist ? 1 : 0
  managed_zone = google_dns_managed_zone.root.name
  name         = "jobs.${var.root_domain}."
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["ghs.googlehosted.com."]

  depends_on = [
    google_dns_managed_zone.root,
    google_project_service.dns,
    google_cloud_run_domain_mapping.jobs,
  ]
}
