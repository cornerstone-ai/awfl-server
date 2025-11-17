# Cloud Run Job container for the producer bridge
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install deps first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source
COPY app ./app

# Default command
CMD ["npm", "start"]
