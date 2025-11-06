# Shared variables for infra

# Base project_id is defined in iam.tf and reused by providers.

variable "region" {
  description = "Primary region for serverless services"
  type        = string
  default     = "us-central1"
}

variable "root_domain" {
  description = "Root DNS domain to manage in Cloud DNS (e.g., awfl.us)"
  type        = string
}

# Name of the Artifact Registry repository to host container images
variable "ar_repo_name" {
  description = "Artifact Registry repository name for Docker images"
  type        = string
  default     = "containers"
}

# GitHub repository that is allowed to assume the deploy service account via WIF
# Format: "owner/repo" (e.g., "awfl/awfl")
variable "github_repository" {
  description = "GitHub repository (owner/repo) allowed to deploy via OIDC Workload Identity Federation"
  type        = string
}

# Whether to create Cloud Run Domain Mappings and associated DNS records.
# Set to true only after the target Cloud Run services (api, jobs) exist in the project/region.
variable "enable_domain_mappings" {
  description = "Create Cloud Run domain mappings and DNS records (requires services to already exist)"
  type        = bool
  default     = false
}