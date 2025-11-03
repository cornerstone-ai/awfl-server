variable "firebase_web_app_display_name" {
  description = "Display name for the Firebase Web App"
  type        = string
  default     = "awfl-web"
}

# Enable necessary Firebase services
resource "google_project_service" "firebase" {
  project            = var.project_id
  service            = "firebase.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "identitytoolkit" {
  project            = var.project_id
  service            = "identitytoolkit.googleapis.com"
  disable_on_destroy = false
}

# Add Firebase to existing GCP project
resource "google_firebase_project" "default" {
  provider = google-beta
  project  = var.project_id

  depends_on = [
    google_project_service.firebase
  ]
}

# Create a Firebase Web App
resource "google_firebase_web_app" "web" {
  provider     = google-beta
  project      = var.project_id
  display_name = var.firebase_web_app_display_name

  depends_on = [google_firebase_project.default]

  lifecycle {
    prevent_destroy = true
  }
}

# Fetch Web App client configuration
data "google_firebase_web_app_config" "web" {
  provider   = google-beta
  web_app_id = google_firebase_web_app.web.app_id
}

# Output individual config values
output "firebase_web_app_api_key" {
  description = "Firebase Web App apiKey (public client key)"
  value       = data.google_firebase_web_app_config.web.api_key
}

output "firebase_web_app_auth_domain" {
  description = "Firebase Auth domain"
  value       = data.google_firebase_web_app_config.web.auth_domain
}

output "firebase_web_app_app_id" {
  description = "Firebase Web App appId"
  value       = google_firebase_web_app.web.app_id
}

# Combined config for frontend consumption
output "firebase_web_client_config" {
  description = "Firebase Web client config (non-sensitive)."
  value = {
    apiKey            = data.google_firebase_web_app_config.web.api_key
    authDomain        = data.google_firebase_web_app_config.web.auth_domain
    projectId         = var.project_id
    appId             = google_firebase_web_app.web.app_id
    storageBucket     = data.google_firebase_web_app_config.web.storage_bucket
    messagingSenderId = data.google_firebase_web_app_config.web.messaging_sender_id
    measurementId     = data.google_firebase_web_app_config.web.measurement_id
  }
}
