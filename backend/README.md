# Beccaccino Backend

## Overview

Node 24 + TypeScript backend for Beccaccino Online: an Express 5 REST API for
mutations and queries, Socket.IO for real-time room and game events, and
PostgreSQL through Prisma. It is the online source of truth for persisted game
state, turn validation, and move acceptance; bot moves come from an external
Python service. Setup and operator procedures are described in
`DEVELOPMENT.md`.

## Interface

- `package.json` scripts: `dev`, `dev:e2e` (runs `db:test:prepare`, then the
  server with `NODE_ENV=test` against the local `becca_test` database),
  `db:test:prepare` (`prisma migrate deploy` with `NODE_ENV=test` against the
  local `becca_test` database), `build` (`prisma generate && tsc`),
  `start` (`node dist/index.js`), `typecheck`, `migrate`
  (`prisma migrate deploy`), `test`, `test:unit`, `test:integration`,
  `practice:export`.
- `jest.config.js`: two Jest projects, `unit` (`tests/unit/**/*.test.ts`) and
  `integration` (`tests/integration/**/*.test.ts`), both with setup file
  `tests/loadTestEnv.ts` and `tests/setup.ts`, plus global teardown
  `tests/teardown.ts`.
- `Dockerfile`: multi-stage `node:24-alpine3.21` build; the runtime image
  runs `npx prisma migrate deploy && node dist/index.js` on port 8000 with a
  `/health` health check.
- Subdirectories:
  - [./src/](./src/): application source (server, routes,
    services, game rules, runtime, sockets, scripts).
  - [./prisma/](./prisma/): `schema.prisma` models, enums,
    and the migration history in `./prisma/migrations`.

## Invariants

- TypeScript compiles `src` only (`rootDir: src`, `outDir: dist`, strict mode,
  `noUnusedLocals`, `noUnusedParameters`); `tests` are excluded from the build
  (`tsconfig.json`).
- Unit and integration tests both load `tests/loadTestEnv.ts` before any
  module import so Prisma sees the test database URL (`jest.config.js`).
- `npm run test:integration` runs serially (`--runInBand`) against PostgreSQL.
- The production image sets `NODE_ENV=production`, deletes source maps, prunes
  dev dependencies, and runs as the `node` user (`Dockerfile`).

## Side Effects

- `npm run build` runs `prisma generate` and writes `dist/`.
- `npm run dev`, `npm run migrate`, and the container start command apply
  Prisma migrations to the configured database. `npm run db:test:prepare` and
  `npm run dev:e2e` apply them to the local `becca_test` database.
- The running server listens on `PORT`, connects to PostgreSQL, calls the bot
  service when `BOT_SERVICE_URL` is configured, and emits Socket.IO events.

## Verification

- Run: `cd backend && npm run typecheck`
- Run: `cd backend && npm run test:unit`
- Run: `cd backend && npm run db:test:prepare` (migrates the local
  `becca_test` PostgreSQL database)
- Run: `cd backend && npm run test:integration` (needs the migrated
  `becca_test` database)
