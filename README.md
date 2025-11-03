# AWFL Server

Overview
- This repository provides the HTTP server that powers both frontend clients (awfl-us/web and awfl-us/cli) and the backend workflows (awfl-us/workflows) used by the AWFL stack.
- It exposes two primary route groups:
  - /api/workflows: client-facing workflow APIs used by web and CLI
  - /jobs: internal jobs and services used by workflows and background tasks
- Local development includes an optional Firestore emulator and an Nginx router for proxying.

Quick start: Local development with the AWFL CLI
- This is the fastest way to bring up the server locally and integrate with the rest of the stack.

Prerequisites
- Python 3.11+
- pipx installed (https://pypa.github.io/pipx/)
- Docker and Docker Compose
- Node.js 22+ (required by this server)

Steps
1) Install the CLI
- pipx install awfl
- Verify: awfl --version

2) Start the dev environment (first run guided setup)
- From this repo root, launch the CLI: awfl
- At the awfl prompt, run: dev start
- On first run, you’ll see a few prompts to set up your local dev workflow. Typical prompts include:
  - Start Docker Compose for the server and dependencies? (recommended: Yes)
  - Start an ngrok https tunnel so external webhooks can reach your dev server? (optional)
  - Start the workflows watcher to regenerate YAMLs (requires awfl-us/workflows) and auto-deploy changes? (optional; requires gcloud)
  - Save these choices as your defaults? (Yes saves a local dev config; you can override any choice later with CLI flags)
- Notes:
  - Next runs reuse your saved answers; precedence is CLI flags > saved config > environment/defaults.
  - dev status shows resolved settings and current process state.
  - dev stop tears down anything started by the CLI session.

3) Validate
- Health check: http://localhost:5050/api/healthz
- If you enabled ngrok, the tunnel URL is printed by the CLI and visible via dev status.

4) Stop
- In the awfl prompt: dev stop
- If you started Docker manually/outside the CLI, use docker compose down as needed.

Key directories
- serve.js: Entrypoint Express server
- jobs/: Job routes (internal services mounted under /jobs)
- workflows/: Workflow orchestrations and client-facing workflow routes (mounted under /api/workflows)
- infra/: Terraform IaC to provision GCP roles/services for the server

Primary services and consumers
- awfl-us/web (frontend)
  - Calls /api/workflows/* for workflow APIs
  - May call /jobs/* in dev or internal tools contexts
- awfl-us/cli (frontend)
  - Calls /api/workflows/* and certain /jobs/* helpers
- awfl-us/workflows (backend library within this repo)
  - Provides workflow orchestration, tools, context assembly, tasks, and event ingestion

API surface (high-level)
- GET /api/healthz: health check
- /api/workflows/*: workflow execution, definitions, and tools
- /jobs/*: internal services used by workflows
  - /jobs/tools/*: shared tools API
  - /jobs/agents/*: agent modules
  - /jobs/events/*: event ingestion
  - /jobs/tasks/*: task tracking
  - /jobs/context/*: context assembly and collapse indexer
    - POST /jobs/context/topicContextYoj/run
    - POST /jobs/context/collapse/indexer/run (mounted under /collapse/indexer/run)

Context module (defaults and notes)
- TopicContextYoj builds request/response context windows from configured components and applies a filter pipeline.
- General default filter order: [ sizeLimiter, toolCallBackfill ]
  - sizeLimiter trims to token budget (default maxTokens ~24000)
  - toolCallBackfill normalizes tool-call sequences and backfills missing tool replies
- TopicContext preset filter order: [ collapseGroupReplacer, fileContentsLimiter, sizeLimiter, toolCallBackfill ]
  - collapseGroupReplacer shrinks sequences into placeholders using user/session-scoped collapse data
  - sizeLimiter uses a tighter budget by default (maxTokens ~20000)

Prerequisites
- Node.js 22+
- Docker and Docker Compose
- Firebase CLI (for local Firestore emulator)
- Terraform > 1.6
- gcloud CLI (for deployment to GCP)

Environment configuration
- Copy .env.example to .env and fill in values you need for local development:
  - GOOGLE_MAPS_API_KEY, OPENAI_API_KEY, optional GITHUB_TOKEN, NODE_ENV
- Service account credentials (GCP):
  - Option A (Docker recommended): place serviceAccountKey.json at repo root (not committed) and it will be mounted into the container at /app/serviceAccountKey.json.
  - Option B (local node): use ADC via gcloud auth application-default login or set GOOGLE_APPLICATION_CREDENTIALS pointing to your key file.
- Safety: never commit real secrets. .env.example is safe to commit; .env and serviceAccountKey.json should be local-only.

Local development
- Using Docker (recommended):
  - docker compose up --build
  - Health check: http://localhost:5050/api/healthz
  - Nginx router exposes 8081 if needed by your setup
- Without Docker:
  - npm install
  - PORT=5050 node serve.js
  - Ensure FIRESTORE_EMULATOR_HOST or real Firestore access is configured as appropriate

Frontend integration
- Set BASE_URL for clients to point to the server, e.g., http://localhost:5050 in development.
- Web and CLI clients primarily call /api/workflows/* and may also call /jobs/* where needed.

Infrastructure (Terraform)
- Goal: provision GCP IAM roles and related resources required by the server/workflows.
- Variables:
  - project_id (non-secret)
  - firestore_location (optional; default "nam5". Immutable after creation.)
  - firebase_web_app_display_name (optional; default "awfl-web")
- Provisioned services/resources:
  - IAM: local dev service account and optional project role bindings
  - Firestore: enables firestore.googleapis.com and creates the default Firestore database in Native mode with lifecycle.prevent_destroy = true
  - Firebase: enables firebase.googleapis.com and identitytoolkit.googleapis.com, adds Firebase to the project, and creates a Firebase Web App
- Outputs:
  - service_account_email
  - service_account_key_json (sensitive)
  - firestore_database_name
  - firebase_web_app_api_key
  - firebase_web_app_auth_domain
  - firebase_web_app_app_id
  - firebase_web_client_config (combined map)
- Setup steps:
  - cd infra
  - cp terraform.tfvars.example dev.auto.tfvars
  - Edit dev.auto.tfvars and set project_id = "YOUR_GCP_PROJECT_ID" (and optionally firestore_location)
  - terraform init
  - Optional: configure remote state (recommended) before first apply:
    - Use a GCS backend bucket (not committed) to avoid local terraform.tfstate in git
  - terraform plan
  - terraform apply
- One-off alternative without files:
  - terraform apply -var="project_id=YOUR_GCP_PROJECT_ID" -var="firestore_location=nam5"
- Notes:
  - Firestore database location_id is immutable once created. Choose carefully (multi-region nam5/eur3 recommended).
  - If a Firestore database already exists in the project (or in Datastore mode), creation will fail; consider importing or reconciling manually.
  - Firebase Web App apiKey is a public client key and not a secret. Keep service account keys and secrets out of source control.
  - project_id is not sensitive; committing terraform.tfvars.example is safe. Keep dev.auto.tfvars local.
  - Do not commit terraform.tfstate; use remote state for teams/CI.

Firebase Web App (client config)
- After apply, retrieve outputs:
  - terraform output firebase_web_client_config
  - terraform output firebase_web_app_api_key
  - terraform output firebase_web_app_auth_domain
  - terraform output firebase_web_app_app_id
- Example client initialization (JS):
  const cfg = /* value of firebase_web_client_config */;
  import { initializeApp } from "firebase/app";
  import { getAuth, GoogleAuthProvider } from "firebase/auth";
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  // signInWithPopup(auth, provider)
- Enable Google Sign-In provider in Firebase Console (Authentication -> Sign-in method) and add your app domain(s) to the authorized domains. This step is not currently managed by Terraform in this repo.

Deployment (example: Cloud Run)
- Build and push an image (Artifact Registry example):
  - gcloud builds submit --tag "us-central1-docker.pkg.dev/PROJECT_ID/REPOSITORY/awfl-server:TAG"
- Deploy to Cloud Run:
  - gcloud run deploy awfl-server \
    --image "us-central1-docker.pkg.dev/PROJECT_ID/REPOSITORY/awfl-server:TAG" \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated \
    --set-env-vars "NODE_ENV=production,WORKFLOW_ENV=Prod,BASE_URL=https://YOUR_DOMAIN" \
    --update-secrets "GOOGLE_APPLICATION_CREDENTIALS=projects/PROJECT_ID/secrets/SVC_KEY:latest"
- Ensure Firestore (or emulator in dev) and any external APIs are reachable from the environment.

Security and safety notes
- Never commit real secrets (OPENAI_API_KEY, GITHUB_TOKEN, serviceAccountKey.json).
- Prefer Google Secret Manager or your secret manager of choice for production.
- Keep Terraform state out of git; configure remote backend in GCS.
- Be mindful of request logs (the dev logger prints headers and body for non-/healthz requests).

Troubleshooting
- If the Firestore emulator is used, ensure ports 8085/4000 are available.
- For CORS/browser use, you may need to enable CORS middleware in serve.js for your origins.
- Check container health at /api/healthz and logs from docker compose.

License
- MIT (see LICENSE)
