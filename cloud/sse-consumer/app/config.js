// Centralized configuration for SSE consumer app

export const NODE_ENV = process.env.NODE_ENV || 'development';

// Upstream workflows/events service base URL
export const WORKFLOWS_BASE_URL = process.env.WORKFLOWS_BASE_URL || 'http://localhost:8081';
// Optional audience to request identity tokens for (OIDC)
export const WORKFLOWS_AUDIENCE = process.env.WORKFLOWS_AUDIENCE || '';

// Inbound service-to-service auth token (shared secret). If unset, auth is skipped.
export const SERVICE_AUTH_TOKEN = process.env.SERVICE_AUTH_TOKEN || '';

// Filesystem work root base directory for per-session/project workspace
export const WORK_ROOT_BASE = process.env.WORK_ROOT_BASE || '/workspace';

// Stream heartbeat interval back to the producer
export const EVENTS_HEARTBEAT_MS = Number(process.env.EVENTS_HEARTBEAT_MS || 15000);

// Tooling limits
export const READ_FILE_MAX_BYTES = Number(process.env.READ_FILE_MAX_BYTES || 512 * 1024);
export const OUTPUT_MAX_BYTES = Number(process.env.OUTPUT_MAX_BYTES || 256 * 1024);
export const RUN_COMMAND_TIMEOUT_SECONDS = Number(process.env.RUN_COMMAND_TIMEOUT_SECONDS || 60);

// Server
export const PORT = Number(process.env.PORT || 8080);
