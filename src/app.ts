// src/app.ts
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import * as Sentry from "@sentry/node";
import dotenv from "dotenv";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";

import userRouter from "./routes/users";
import roomRouter from "./routes/rooms";
import gameRouter from "./routes/games";
import { logger } from "./logger";

dotenv.config();

const app = express();

// Security headers
app.use(helmet());

// Per-request structured logging with a request id. Each handler can read
// `req.log` for a child logger that already includes the id in every line.
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const existing = req.headers["x-request-id"];
      const id = (typeof existing === "string" && existing) || randomUUID();
      res.setHeader("x-request-id", id);
      return id;
    },
    // Quiet noisy probe traffic; keep error-level for failures.
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      if (res.statusCode === 200 && _req.url === "/health") return "debug";
      return "info";
    },
  }),
);

// CORS configuration per permettere cookies
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:8081",
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// Disable keep-alive in test mode to prevent flaky "Parse Error: Expected HTTP/"
if (process.env.NODE_ENV === "test") {
  app.set("trust proxy", false);
  app.use((req, res, next) => {
    res.set("Connection", "close");
    res.set("Keep-Alive", "timeout=0");
    next();
  });
}

app.use("/api/users", userRouter);
app.use("/api/rooms", roomRouter);
app.use("/api/games", gameRouter);

// Global error handler — catches unhandled errors from async routes (Express 5)
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    Sentry.captureException(err);
    (req.log ?? logger).error({ err }, "unhandled_error");
    res.status(500).json({ error: "Internal server error" });
  },
);

export default app;
