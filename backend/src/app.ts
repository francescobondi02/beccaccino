// src/app.ts
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";

import userRouter from "./routes/users";
import roomRouter from "./routes/rooms";
import gameRouter from "./routes/games";
import { logger } from "./logger";
import { prisma } from "./db";
import { errorHandler } from "./http/errorHandler";
import { isRuntimeRecoveryReady } from "./runtime/recovery";

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

app.use(express.json());
app.use(cookieParser());

// Disable keep-alive in test mode to prevent flaky "Parse Error: Expected HTTP/"
if (process.env.NODE_ENV === "test") {
  app.set("trust proxy", false);
  app.use((_req, res, next) => {
    res.set("Connection", "close");
    res.set("Keep-Alive", "timeout=0");
    next();
  });
} else {
  // One hop (Render): req.ip is Vercel's egress IP for web, the device IP for native.
  app.set("trust proxy", 1);
}

app.use("/api/users", userRouter);
app.use("/api/rooms", roomRouter);
app.use("/api/games", gameRouter);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/ready", async (_req, res) => {
  if (!isRuntimeRecoveryReady()) {
    res
      .status(503)
      .json({ status: "not_ready", reason: "runtime recovery incomplete" });
    return;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ready" });
  } catch {
    res
      .status(503)
      .json({ status: "not_ready", reason: "database unreachable" });
  }
});

app.use(errorHandler);

export default app;
