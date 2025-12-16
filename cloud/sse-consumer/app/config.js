// Centralized configuration for consumer app (Pub/Sub worker)

export const NODE_ENV = process.env.NODE_ENV || 'development';

// Pub/Sub transport
export const PUBSUB_ENABLE = ['1','true','yes'].includes(String(process.env.PUBSUB_ENABLE || '1').toLowerCase());
export const TOPIC = process.env.TOPIC || '';
export const SUBSCRIPTION = process.env.SUBSCRIPTION || '';
export const REPLY_CHANNEL = process.env.REPLY_CHANNEL || 'resp';

// Encryption
export const ENC_KEY_B64 = process.env.ENC_KEY_B64 || '';
export const ENC_VER = process.env.ENC_VER || 'a256gcm:v1';

// Optional idle exit (ms) to allow graceful shutdown of Jobs when no traffic
export const IDLE_EXIT_MS = Number(process.env.IDLE_EXIT_MS || 0); // 0 = disabled

// Workspace
export const WORK_ROOT_BASE = process.env.WORK_ROOT_BASE || '/workspace';
export const WORK_PREFIX_TEMPLATE = process.env.WORK_PREFIX_TEMPLATE || '{userId}/{projectId}/{workspaceId}/{sessionId}';

// GCS sync configuration (align with routes/stream behavior)
export const GCS_API_BASE = process.env.GCS_API_BASE || 'https://www.googleapis.com';
export const GCS_DOWNLOAD_CONCURRENCY = Number(process.env.GCS_DOWNLOAD_CONCURRENCY || 8);
export const GCS_UPLOAD_CONCURRENCY = Number(process.env.GCS_UPLOAD_CONCURRENCY || 4);
export const GCS_ENABLE_UPLOAD = ['1','true','yes'].includes(String(process.env.GCS_ENABLE_UPLOAD || '1').toLowerCase());
export const GCS_BUCKET = process.env.GCS_BUCKET || '';
export const GCS_PREFIX_TEMPLATE = process.env.GCS_PREFIX_TEMPLATE || '{userId}/{projectId}/{sessionId}/';
export const GCS_BILLING_PROJECT = process.env.GCS_BILLING_PROJECT || process.env.BILLING_PROJECT || '';

// Sync toggles to mirror the legacy SSE route behavior
export const SYNC_ON_START = ['1','true','yes'].includes(String(process.env.SYNC_ON_START || '1').toLowerCase());
export const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 5000); // 0 disables periodic sync

// Tooling limits
export const READ_FILE_MAX_BYTES = Number(process.env.READ_FILE_MAX_BYTES || 512 * 1024);
export const OUTPUT_MAX_BYTES = Number(process.env.OUTPUT_MAX_BYTES || 256 * 1024);
export const RUN_COMMAND_TIMEOUT_SECONDS = Number(process.env.RUN_COMMAND_TIMEOUT_SECONDS || 60);
