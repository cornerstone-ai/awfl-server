# Artifact Registry setup

# Existing repo used by `gcloud run deploy --source` (kept for reference/back-compat)
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

# Allow the GitHub deploy service account to read the repository metadata
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

# New dedicated repo for image-based Cloud Run deploys
resource "google_artifact_registry_repository" "app" {
  project       = var.project_id
  location      = var.region
  repository_id = "app"
  description   = "Application images for Cloud Run"
  format        = "DOCKER"

  depends_on = [
    google_project_service.artifactregistry,
  ]
}

# GitHub deploy SA can push (writer) to the new repo
resource "google_artifact_registry_repository_iam_member" "app_writer_deployer" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.app.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"

  depends_on = [
    google_artifact_registry_repository.app,
  ]
}

# Runtime service account can pull (reader) from the new repo
resource "google_artifact_registry_repository_iam_member" "app_reader_runtime" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.app.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"

  depends_on = [
    google_artifact_registry_repository.app,
  ]
}
