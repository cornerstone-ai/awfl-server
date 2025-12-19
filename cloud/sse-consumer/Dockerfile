# Node-only SSE consumer for local dev and Cloud Run
# - Uses Node 22 (includes global fetch)
# - Installs production deps only
# - Runs as non-root user and writes workspace under /workspace
#
# GitHub auth:
# - Provide authentication via one of:
#   - Set environment variable GH_TOKEN or GITHUB_TOKEN to a classic GitHub PAT
#     with at least public_repo scope (repo if you might fork private repos), OR
#   - Use interactive auth: gh auth login --web

FROM node:22-slim AS base
ENV NODE_ENV=production
WORKDIR /app

# Install OS utilities needed for git/GitHub operations.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       git \
       openssh-client \
       gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (gh) v2.x from the official GitHub apt repo.
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Install deps separately for better layer caching.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force

# App sources
COPY app ./app
COPY README.md ./README.md

# Prepare writable workspace for tools
RUN mkdir -p /workspace && chown -R node:node /workspace

USER node

CMD ["node", "app/worker.js"]
