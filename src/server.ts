import http from "http";
import { Server } from "socket.io";
import app from "./app";
import { logger } from "./logger";
import { registerRoomSocket } from "./sockets/room";
import { setSocketInstance } from "./socketInstance";
import { verifyToken } from "./utils/jwt";

type SocketHandshake = {
  address: string;
  headers: Record<string, string | string[] | undefined>;
};

export type CreateServerOptions = {
  allowTestAuthBypass?: boolean;
  corsOrigin?: string;
  maxSocketsPerIp?: number;
};

export type CreatedServer = {
  httpServer: http.Server;
  io: Server;
  close: () => Promise<void>;
};

function getClientIp(handshake: SocketHandshake): string {
  const forwardedFor = handshake.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }
  return handshake.address;
}

export function createServer(
  options: CreateServerOptions = {},
): CreatedServer {
  const corsOrigin =
    options.corsOrigin ??
    process.env.FRONTEND_URL ??
    "http://localhost:8081";
  const allowTestAuthBypass =
    process.env.NODE_ENV === "test" &&
    (options.allowTestAuthBypass ??
      process.env.ALLOW_TEST_AUTH_BYPASS === "true");
  const maxSocketsPerIp =
    options.maxSocketsPerIp ??
    parseInt(process.env.MAX_SOCKETS_PER_IP || "10", 10);

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
    path: "/socket.io/",
    maxHttpBufferSize: 10_240,
  });
  setSocketInstance(io);

  io.use((socket, next) => {
    if (allowTestAuthBypass) return next();

    const cookieHeader = socket.handshake.headers.cookie;
    const match = cookieHeader?.match(/authToken=([^;]+)/);
    if (!match) return next(new Error("Authentication required"));

    const decoded = verifyToken(match[1]);
    if (!decoded) return next(new Error("Invalid or expired token"));

    socket.data.user = decoded;
    next();
  });

  const ipConnectionCounts = new Map<string, number>();
  io.use((socket, next) => {
    const ip = getClientIp(socket.handshake);
    const current = ipConnectionCounts.get(ip) ?? 0;
    if (current >= maxSocketsPerIp) {
      logger.warn({ ip, current }, "socket_per_ip_limit_exceeded");
      return next(new Error("Too many connections from this IP"));
    }

    ipConnectionCounts.set(ip, current + 1);
    socket.data.clientIp = ip;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const remaining = (ipConnectionCounts.get(ip) ?? 1) - 1;
      if (remaining <= 0) ipConnectionCounts.delete(ip);
      else ipConnectionCounts.set(ip, remaining);
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
          ipConnectionCounts.clear();
          resolve();
        });
      });
    }
    return closePromise;
  };

  return { httpServer, io, close };
}
