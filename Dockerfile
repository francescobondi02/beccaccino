FROM node:24-alpine3.21

WORKDIR /app

# 1) Install deps (cached better)
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# 2) Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

# 3) Runtime command: migrate then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]