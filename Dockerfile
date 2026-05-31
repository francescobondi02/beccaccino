FROM node:24-alpine3.21 AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npx prisma generate
RUN npm run build

# Upload source maps to Sentry (no-op if SENTRY_AUTH_TOKEN/ORG/PROJECT not set
# — pass them as build secrets/build args). Source maps stay on disk; we drop
# the .map files from the runtime image below to keep it slim.
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_RELEASE
ARG RENDER_GIT_COMMIT
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    SENTRY_RELEASE=$SENTRY_RELEASE \
    RENDER_GIT_COMMIT=$RENDER_GIT_COMMIT
RUN npm run sentry:sourcemaps

# Drop .map files from the build output before pruning — they were only needed
# to upload to Sentry; serving them from the runtime image is wasted bytes.
RUN find dist -name "*.map" -type f -delete
RUN npm prune --omit=dev

# --- Production image ---
FROM node:24-alpine3.21

RUN apk add --no-cache wget
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

EXPOSE 8000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://localhost:8000/health || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
