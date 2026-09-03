// src/app.ts
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import dotenv from "dotenv";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import path from "path";

import userRouter from "./routes/users";
import roomRouter from "./routes/rooms";
import gameRouter from "./routes/games";
import annotationRouter from "./routes/annotations";
import { logger } from "./logger";
import { prisma } from "./db";
import { errorHandler } from "./http/errorHandler";
import { frontendOrigin } from "./http/frontendOrigin";
import { isRuntimeRecoveryReady } from "./runtime/recovery";

dotenv.config();

const app = express();

const publicDirectory = path.resolve(process.cwd(), "public");

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
    origin: frontendOrigin(),
    credentials: true,
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
  // Behind Render's load balancer: trust exactly one proxy hop so req.ip is the
  // client address (from X-Forwarded-For) and rate limiters bucket per client,
  // not per LB. Never `true` — that trusts arbitrary spoofed forwarded chains.
  app.set("trust proxy", 1);
}

app.use("/api/users", userRouter);
app.use("/api/rooms", roomRouter);
app.use("/api/games", gameRouter);
app.use("/api/annotations", annotationRouter);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/version", (_req, res) => {
  res.status(200).json({
    service: "backend",
    commit:
      process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA || "unknown",
  });
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

// Serve static files from the public directory
app.use(express.static(publicDirectory));

app.use((req, res, next) => {
  const isFrontendNavigation =
    req.method === "GET" &&
    !req.path.startsWith("/api/") &&
    !req.path.startsWith("/socket.io/");
  if (!isFrontendNavigation) return next();
  res.sendFile(path.join(publicDirectory, "index.html"));
});

app.use(errorHandler);

export default app;
