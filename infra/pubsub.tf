# Shared Pub/Sub topic for AWFL request/response channels

variable "pubsub_topic_name" {
  description = "Shared Pub/Sub topic name for AWFL request/response"
  type        = string
  default     = "awfl-events"
}

resource "google_pubsub_topic" "shared" {
  name = var.pubsub_topic_name
  labels = {
    app     = "awfl"
    purpose = "events"
  }
}

# Grant publisher on the shared topic to Producer and Consumer service accounts
resource "google_pubsub_topic_iam_member" "producer_publisher" {
  topic  = google_pubsub_topic.shared.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.producer.email}"
}

resource "google_pubsub_topic_iam_member" "consumer_publisher" {
  topic  = google_pubsub_topic.shared.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.consumer.email}"
}

output "pubsub_topic_name" {
  description = "Name of the shared Pub/Sub topic"
  value       = google_pubsub_topic.shared.name
}
