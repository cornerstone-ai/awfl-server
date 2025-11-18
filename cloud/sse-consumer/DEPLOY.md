SSE Consumer — Cloud Run deployment with Cloud Storage mount

Overview
- The consumer can use a project/workspace-scoped working directory rooted at WORK_ROOT. In Cloud Run, mount a Cloud Storage bucket at this path using Cloud Run volumes.
- GCS FUSE is handled by Cloud Run; you do not need to run gcsfuse inside the container.

Prerequisites
- A GCS bucket to mount (infra/storage.tf provisions one and outputs gcs_bucket_name)
- Runtime service account with storage.objectAdmin on the bucket (optionally restricted via IAM Conditions to per-project prefixes)
- Built image for the consumer

Deploy
1) Deploy (first time):
  gcloud run deploy sse-consumer \
    --image gcr.io/$PROJECT_ID/sse-consumer:TAG \
    --region $REGION \
    --no-allow-unauthenticated \
    --concurrency 10 \
    --timeout 3600 \
    --service-account $SERVICE_ACCOUNT_EMAIL \
    --set-env-vars WORK_ROOT=/mnt/work,WORK_PREFIX_TEMPLATE="{projectId}/{workspaceId}",WORKFLOWS_BASE_URL=$WORKFLOWS_BASE_URL,WORKFLOWS_AUDIENCE=$WORKFLOWS_AUDIENCE

2) Mount the bucket using Cloud Run volumes:
  gcloud run services update sse-consumer \
    --region $REGION \
    --add-volume name=work,type=cloud-storage,bucket=$WORK_BUCKET \
    --add-volume-mount volume=work,mount-path=/mnt/work

Notes
- You do not need to set ENABLE_GCS_FUSE when using Cloud Run volumes; leave it unset or false.
- For local docker, bind-mount a host folder to /mnt/work (see scripts/dev.sh) and the consumer will create per-request directories under that mount.
- To restrict access by prefix, grant the runtime service account storage.objectAdmin on the bucket with an IAM Condition like:
  resource.name.startsWith("projects/_/buckets/$WORK_BUCKET/objects/${PROJECT_ID}/")
