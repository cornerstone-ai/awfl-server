terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.4"
    }
  }
}

provider "google" {
  project               = var.project_id
  # Ensure requests made with user ADC set the quota/billing project header
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  # Ensure requests made with user ADC set the quota/billing project header
  user_project_override = true
  billing_project       = var.project_id
}

# local provider needed for local_file resource
provider "local" {}
