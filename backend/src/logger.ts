// src/logger.ts
// Structured logger (pino). Emits JSON in production for Render log ingestion;
// pretty output in development if `pino-pretty` is installed.
//
// Usage:
//   import { logger } from "./logger";
//   logger.info({ roomCode, userId }, "card_played");
//   logger.error({ err, roomCode }, "play_card_failed");
//
// Requests get a child logger with a request id via `pino-http` (see app.ts).
// Inside controllers/sockets, prefer the request/socket-scoped logger when
// available; otherwise fall back to the module-level `logger`.

import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? "silent" : "info"),
  // Redact common secret-bearing fields anywhere in the log object.
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "headers.cookie",
      "headers.authorization",
      "password",
      "*.password",
      "token",
      "*.token",
      "authToken",
      "*.authToken",
    ],
    censor: "[REDACTED]",
  },
  // Cleaner JSON in production; pretty in dev if available.
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l" },
        },
      }),
});
