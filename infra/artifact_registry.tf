# Artifact Registry setup for Cloud Run source deploys

# Create the default repository used by `gcloud run deploy --source`
# Name must be exactly "cloud-run-source-deploy" in the target region.
resource "google_artifact_registry_repository" "cloud_run_source_deploy" {
  project       = var.project_id
  location      = var.region
  repository_id = "cloud-run-source-deploy"
  description   = "Default repo for Cloud Run source-based deploys"
  format        = "DOCKER"

  depends_on = [
    google_project_service.artifactregistry,
  ]
}

# Allow the GitHub deploy service account to read the repository metadata (and later pull images if needed)
resource "google_artifact_registry_repository_iam_member" "deployer_reader" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.cloud_run_source_deploy.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"

  depends_on = [
    google_artifact_registry_repository.cloud_run_source_deploy,
  ]
}

# Allow Cloud Build service account to write images to the repository
resource "google_artifact_registry_repository_iam_member" "cloudbuild_writer" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.cloud_run_source_deploy.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_project.project.number}@cloudbuild.gserviceaccount.com"

  depends_on = [
    google_artifact_registry_repository.cloud_run_source_deploy,
    google_project_service.cloudbuild,
  ]
}