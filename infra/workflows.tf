# Enable Google Workflows and Workflow Executions APIs
# Fixes: PERMISSION_DENIED for workflowexecutions.googleapis.com

resource "google_project_service" "workflows" {
  project            = var.project_id
  service            = "workflows.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "workflowexecutions" {
  project            = var.project_id
  service            = "workflowexecutions.googleapis.com"
  disable_on_destroy = false
}
