#!/usr/bin/env bash
set -euo pipefail

# Local dev runner for the producer bridge (no Cloud Run Job)
# Usage:
#   cloud/producer/scripts/dev.sh <USER_ID> <PROJECT_ID> [WORKSPACE_ID]
#
# Requires the workflows service and the SSE consumer service running locally.
# Reads optional env from .env at repo root.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/../../.."
cd "$REPO_ROOT/cloud/producer"

if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a; source "$REPO_ROOT/.env"; set +a
fi

USER_ID="${1:-}"
PROJECT_ID="${2:-}"
WORKSPACE_ID="${3:-}"

if [[ -z "$USER_ID" || -z "$PROJECT_ID" ]]; then
  echo "Usage: $0 <USER_ID> <PROJECT_ID> [WORKSPACE_ID]" >&2
  exit 2
fi

: "${WORKFLOWS_BASE_URL:=http://localhost:8080}"
: "${WORKFLOWS_AUDIENCE:=$WORKFLOWS_BASE_URL}"
: "${CONSUMER_BASE_URL:=http://localhost:8090}"
: "${SERVICE_AUTH_TOKEN:=dev-shared-token}"

export X_USER_ID="$USER_ID"
export X_PROJECT_ID="$PROJECT_ID"
[[ -n "$WORKSPACE_ID" ]] && export X_WORKSPACE_ID="$WORKSPACE_ID"

# Optional replay controls
# export SINCE_ID=""
# export SINCE_TIME=""

npm ci --omit=dev || npm install --omit=dev
node app/runner.js