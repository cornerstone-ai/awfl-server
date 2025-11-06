# Generate a JSON file with GitHub Actions repo variables to be set on merge
# The workflow in .github/workflows/set-actions-variables.yml will read this file
# and set/update repository-level Actions Variables via the GitHub CLI using GITHUB_TOKEN.

locals {
  # Default compute runtime service account (used by Cloud Run by default)
  default_compute_sa = "${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

resource "local_file" "actions_variables" {
  filename = "${path.module}/../.github/actions-variables.json"
  content  = jsonencode({
    GCP_WIF_PROVIDER       = google_iam_workload_identity_pool_provider.github.name
    GCP_DEPLOY_SA          = google_service_account.github_deployer.email
    GCP_PROJECT_ID         = var.project_id
    GCP_REGION             = var.region
    CLOUD_RUN_RUNTIME_SA   = local.default_compute_sa
    CLOUD_RUN_API_SERVICE  = "api"
    CLOUD_RUN_JOBS_SERVICE = "jobs"
  })
  depends_on = [
    google_iam_workload_identity_pool_provider.github,
    google_service_account.github_deployer,
  ]
}
