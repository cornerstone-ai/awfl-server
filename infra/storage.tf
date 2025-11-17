# Storage API and shared bucket for MVP persistence

variable "storage_bucket_name" {
  description = "Optional explicit name for the shared GCS bucket. Must be globally unique if set."
  type        = string
  default     = null
}

variable "bucket_location" {
  description = "Bucket location (region or multi-region)."
  type        = string
  default     = "US"
}

# Ensure GCS API is enabled
resource "google_project_service" "storage" {
  project            = var.project_id
  service            = "storage.googleapis.com"
  disable_on_destroy = false
  depends_on = [
    google_project_service.cloudresourcemanager,
    google_project_service.serviceusage,
  ]
}

locals {
  default_bucket_name = "${var.project_id}-work-bucket"
  shared_bucket_name  = coalesce(var.storage_bucket_name, local.default_bucket_name)
}

resource "google_storage_bucket" "shared" {
  name                        = lower(local.shared_bucket_name)
  location                    = var.bucket_location
  uniform_bucket_level_access = true
  force_destroy               = true

  lifecycle_rule {
    condition { age = 30 }
    action { type = "Delete" }
  }

  depends_on = [google_project_service.storage]
}

output "gcs_bucket_name" {
  description = "Name of the shared GCS bucket for work persistence"
  value       = google_storage_bucket.shared.name
}
