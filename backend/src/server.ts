import http from "http";
import { Server } from "socket.io";
import app from "./app";
import { logger } from "./logger";
import { registerRoomSocket } from "./sockets/room";
import { setSocketInstance } from "./socketInstance";
import {
  authTokenFromCookieHeader,
  verifyActiveSession,
} from "./auth/activeSession";

export type CreateServerOptions = {
  maxSocketsPerIp?: number;
};

export type CreatedServer = {
  httpServer: http.Server;
  io: Server;
  close: () => Promise<void>;
};

export function createServer(options: CreateServerOptions = {}): CreatedServer {
  const maxSocketsPerIp =
    options.maxSocketsPerIp ??
    parseInt(process.env.MAX_SOCKETS_PER_IP || "10", 10);

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    path: "/socket.io/",
    maxHttpBufferSize: 10_240,
  });
  setSocketInstance(io);

  io.use(async (socket, next) => {
    const nativeToken: unknown = socket.handshake.auth?.token;
    const token = nativeToken === undefined
      ? authTokenFromCookieHeader(socket.handshake.headers.cookie)
      : nativeToken;
    if (!token) return next(new Error("Authentication required"));
    if (typeof token !== "string" || !/^\S+$/.test(token)) {
      return next(new Error("Invalid or expired token"));
    }

    try {
      const session = await verifyActiveSession(token);
      if (!session) return next(new Error("Invalid or expired token"));

      socket.data.user = session;
      next();
    } catch (error) {
      logger.error({ err: error }, "socket_authentication_failed");
      next(new Error("Authentication unavailable"));
    }
  });

  // Keyed by the verified account: forwarded IPs are spoofable, and website
  // sockets share the Vercel proxy's egress IP.
  const connectionCounts = new Map<string, number>();
  io.use((socket, next) => {
    const key = `user:${socket.data.user.userId}`;
    const current = connectionCounts.get(key) ?? 0;
    if (current >= maxSocketsPerIp) {
      logger.warn({ key, current }, "socket_connection_limit_exceeded");
      return next(new Error("Too many connections"));
    }

    connectionCounts.set(key, current + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const remaining = (connectionCounts.get(key) ?? 1) - 1;
      if (remaining <= 0) connectionCounts.delete(key);
      else connectionCounts.set(key, remaining);
    };
    socket.on("disconnect", release);
    socket.conn.once("close", release);
    next();
  });

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

  let closePromise: Promise<void> | null = null;
  const close = () => {
    if (!closePromise) {
      closePromise = new Promise<void>((resolve) => {
        io.close(() => {
          connectionCounts.clear();
          resolve();
        });
      });
    }
    return closePromise;
  };

  return { httpServer, io, close };
}
