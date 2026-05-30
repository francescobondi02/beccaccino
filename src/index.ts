// src/index.ts
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import { Server } from "socket.io";

import app from "./app";
import { prisma } from "./db";
import { registerRoomSocket } from "./sockets/room";
import { setSocketInstance } from "./socketInstance";
import { verifyToken } from "./utils/jwt";

// --- Env validation: fail fast on missing critical vars ---
const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:8081",
    credentials: true,
  },
  path: "/socket.io/",
  maxHttpBufferSize: 10_240, // 10 KB — card game payloads are tiny
});

setSocketInstance(io);

// Socket.IO authentication middleware
io.use((socket, next) => {
  if (process.env.NODE_ENV === "test") {
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

// Health check — verifies DB connectivity
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unhealthy", reason: "database unreachable" });
  }
});

// WebSocket logic
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id, "user:", socket.data.user?.username);
  registerRoomSocket(socket, io);
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- Graceful shutdown ---
let isShuttingDown = false;
const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received. Shutting down...`);

  io.close();
  server.close();
  await prisma.$disconnect();
  console.log("Server closed.");
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// --- Process-level error handlers ---
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});
