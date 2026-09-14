FROM node:24-alpine3.21 AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Source maps are uploaded by the trusted deployment workflow.
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
