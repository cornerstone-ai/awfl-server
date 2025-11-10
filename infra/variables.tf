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

# ------------------------------
# Remote state settings for the web (frontend) stack
# ------------------------------
variable "web_tfstate_bucket_name" {
  description = "GCS bucket name that hosts the web (frontend) Terraform state"
  type        = string
  # Default provided per user: the web repo manages this bucket
  default     = "tfstate-awfl-web"
}

variable "web_tfstate_prefix" {
  description = "Object prefix (folder) within the web state bucket (e.g., workspace path)"
  type        = string
  # Default provided per user for prod
  default     = "infra/envs/prod"
}

# ------------------------------
# DNS defaults
# ------------------------------
variable "dns_default_ttl" {
  description = "Default TTL (seconds) to apply to DNS records when TTL is not provided by remote state"
  type        = number
  default     = 300
}
