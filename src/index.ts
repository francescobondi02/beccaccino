// src/index.ts
import dotenv from "dotenv";
dotenv.config();

import "./instrument";

import http from "http";
import { Server } from "socket.io";

import app from "./app";
import { prisma } from "./db";
import { registerRoomSocket } from "./sockets/room";
import { setSocketInstance } from "./socketInstance";
import { verifyToken } from "./utils/jwt";
import { logger } from "./logger";
import { startMetrics, stopMetrics } from "./services/metrics";

// --- Env validation: fail fast on missing critical vars ---
const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.fatal({ envVar: key }, "missing_required_env_var");
    process.exit(1);
  }
}

// In production, FRONTEND_URL MUST be set explicitly so CORS doesn't silently
// fall back to localhost (which would block all real cross-origin requests).
if (process.env.NODE_ENV === "production" && !process.env.FRONTEND_URL) {
  logger.fatal("FRONTEND_URL is required in production");
  process.exit(1);
}

const corsOrigin = process.env.FRONTEND_URL || "http://localhost:8081";

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    credentials: true,
  },
  path: "/socket.io/",
  maxHttpBufferSize: 10_240, // 10 KB — card game payloads are tiny
});

setSocketInstance(io);

// Test auth bypass requires BOTH NODE_ENV=test AND an explicit opt-in env var,
// so a misconfigured production deploy can never disable auth.
const isTestAuthBypassEnabled =
  process.env.NODE_ENV === "test" &&
  process.env.ALLOW_TEST_AUTH_BYPASS === "true";

// Per-IP socket connection cap. A real player needs at most ~2 sockets
// (one tab + a backgrounded reconnect). Anything above this limit is almost
// certainly abuse or a bug client.
const MAX_SOCKETS_PER_IP = parseInt(
  process.env.MAX_SOCKETS_PER_IP || "10",
  10,
);
const ipConnectionCounts = new Map<string, number>();

function getClientIp(socket: { handshake: { address: string; headers: Record<string, string | string[] | undefined> } }): string {
  // Render terminates TLS upstream and forwards the real IP via XFF.
  const xff = socket.handshake.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return socket.handshake.address;
}

io.use((socket, next) => {
  const ip = getClientIp(socket);
  const current = ipConnectionCounts.get(ip) ?? 0;
  if (current >= MAX_SOCKETS_PER_IP) {
    logger.warn({ ip, current }, "socket_per_ip_limit_exceeded");
    return next(new Error("Too many connections from this IP"));
  }
  ipConnectionCounts.set(ip, current + 1);
  socket.data.clientIp = ip;
  socket.on("disconnect", () => {
    const n = (ipConnectionCounts.get(ip) ?? 1) - 1;
    if (n <= 0) ipConnectionCounts.delete(ip);
    else ipConnectionCounts.set(ip, n);
  });
  next();
});

// Socket.IO authentication middleware
io.use((socket, next) => {
  if (isTestAuthBypassEnabled) {
    return next();
  }

  const cookieHeader = socket.handshake.headers.cookie;
  if (!cookieHeader) {
    return next(new Error("Authentication required"));
  }

  const match = cookieHeader.match(/authToken=([^;]+)/);
  if (!match) {
    return next(new Error("Authentication required"));
  }

  const decoded = verifyToken(match[1]);
  if (!decoded) {
    return next(new Error("Invalid or expired token"));
  }

  socket.data.user = decoded;
  next();
});

// Liveness — answers "is the process alive?" Always 200 if Express is
// running. Used by Render's container restart probe; we deliberately do NOT
// fail this on transient DB issues, because restarting the process won't
// fix the database.
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Readiness — answers "is this instance able to serve traffic?" Probes the
// DB. Use for blue/green cutovers or load balancers; safe to return 503
// here without triggering restarts.
app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ready" });
  } catch {
    res
      .status(503)
      .json({ status: "not_ready", reason: "database unreachable" });
  }
});

// WebSocket logic
io.on("connection", (socket) => {
  logger.info(
    {
      socketId: socket.id,
      userId: socket.data.user?.userId,
      username: socket.data.user?.username,
    },
    "socket_connected",
  );
  registerRoomSocket(socket, io);
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;
server.listen(PORT, () => {
  logger.info({ port: PORT }, "server_started");
  if (process.env.NODE_ENV !== "test") {
    startMetrics();
  }
});

// --- Graceful shutdown ---
let isShuttingDown = false;
const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "shutdown_initiated");

  stopMetrics();
  io.close();
  server.close();
  await prisma.$disconnect();
  logger.info("shutdown_complete");
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// --- Process-level error handlers ---
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled_rejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught_exception");
  process.exit(1);
});
