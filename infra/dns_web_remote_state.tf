# Consume web (frontend) Terraform remote state to create DNS records in this project's Cloud DNS zone.
# The web stack owns its own state and exposes outputs we read here.

# Remote state for the web repo (GCS backend)
data "terraform_remote_state" "web" {
  backend = "gcs"
  config = {
    bucket = var.web_tfstate_bucket_name
    prefix = var.web_tfstate_prefix
  }
}

locals {
  # Safely read outputs (default to empty list if not present)
  web_root_records_raw = try(data.terraform_remote_state.web.outputs.root_records, [])
  web_www_records_raw  = try(data.terraform_remote_state.web.outputs.www_records, [])

  # Exclude TXT to avoid conflicts with site verification management elsewhere
  web_root_records = [for r in local.web_root_records_raw : r if upper(try(r.type, "")) != "TXT"]
  web_www_records  = [for r in local.web_www_records_raw  : r if upper(try(r.type, "")) != "TXT"]

  # Build grouped records by type for the apex (root) and www names.
  # The web outputs are a flat list of objects with {name, type, rrdata} and no ttl/rrdatas fields.
  # We group them by record type and construct rrdatas arrays, applying a default TTL.

  root_types = toset([for r in local.web_root_records : upper(try(r.type, ""))])
  www_types  = toset([for r in local.web_www_records  : upper(try(r.type, ""))])

  root_groups = {
    for t in local.root_types : t => {
      name    = "${var.root_domain}."
      type    = t
      rrdatas = [for r in local.web_root_records : r.rrdata if upper(try(r.type, "")) == t]
      ttl     = var.dns_default_ttl
    }
    if length([for r in local.web_root_records : r if upper(try(r.type, "")) == t]) > 0
  }

  www_groups = {
    for t in local.www_types : t => {
      name    = "www.${var.root_domain}."
      type    = t
      rrdatas = [for r in local.web_www_records : r.rrdata if upper(try(r.type, "")) == t]
      ttl     = var.dns_default_ttl
    }
    if length([for r in local.web_www_records : r if upper(try(r.type, "")) == t]) > 0
  }
}

# Create root (apex) records from the grouped web outputs
resource "google_dns_record_set" "web_root" {
  for_each     = local.root_groups
  managed_zone = google_dns_managed_zone.root.name
  name         = each.value.name
  type         = each.value.type
  ttl          = each.value.ttl
  rrdatas      = each.value.rrdatas

  depends_on = [
    google_dns_managed_zone.root,
    google_project_service.dns,
  ]
}

# Create www records from the grouped web outputs
resource "google_dns_record_set" "web_www" {
  for_each     = local.www_groups
  managed_zone = google_dns_managed_zone.root.name
  name         = each.value.name
  type         = each.value.type
  ttl          = each.value.ttl
  rrdatas      = each.value.rrdatas

  depends_on = [
    google_dns_managed_zone.root,
    google_project_service.dns,
  ]
}
