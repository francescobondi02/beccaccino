// src/index.ts
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import { Server } from "socket.io";

import app from "./app";
import { registerRoomSocket } from "./sockets/room";
import { setSocketInstance } from "./socketInstance";
import { verifyToken } from "./utils/jwt";

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:8081",
    credentials: true,
  },
  path: "/socket.io/",
  maxHttpBufferSize: 10_240, // 10 KB — card game payloads are tiny
});

// Inizializza l'istanza socket globale
setSocketInstance(io);

// Socket.IO authentication middleware
// Verifica il JWT cookie all'handshake. Bypass in test environment.
io.use((socket, next) => {
  if (process.env.NODE_ENV === "test") {
    return next();
  }

  const cookieHeader = socket.handshake.headers.cookie;
  if (!cookieHeader) {
    return next(new Error("Authentication required"));
  }

  // Parse authToken from cookie header
  const match = cookieHeader.match(/authToken=([^;]+)/);
  if (!match) {
    return next(new Error("Authentication required"));
  }

  const decoded = verifyToken(match[1]);
  if (!decoded) {
    return next(new Error("Invalid or expired token"));
  }

  // Attach user to socket for use in handlers
  socket.data.user = decoded;
  next();
});

// Endpoint di test
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

// WebSocket logic
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id, "user:", socket.data.user?.username);

  // Registra gli eventi della room (lobby e gioco)
  registerRoomSocket(socket, io);
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Graceful shutdown
const shutdown = (signal: string) => {
  console.log(`${signal} received. Shutting down...`);
  io.close();
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
