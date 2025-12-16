# Cloud Run Job container for the producer bridge
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install a proper init to handle signals and reaping
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

# Install deps first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source
COPY app ./app

# Ensure signals reach Node (avoid npm as PID 1)
ENTRYPOINT ["tini", "--"]
CMD ["node", "app/runner.js"]
