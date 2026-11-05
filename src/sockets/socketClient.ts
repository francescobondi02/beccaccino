// src/sockets/socketClient.ts
import { io, Socket } from "socket.io-client";
import { toast } from "sonner";
import type { ServerToClientEvents, ClientToServerEvents } from "./events";

const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin
  : import.meta.env.VITE_SOCKET_URL || window.location.origin;

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";
let connectionStatus: ConnectionStatus = "disconnected";
const statusListeners: Set<(status: ConnectionStatus) => void> = new Set();

function setStatus(status: ConnectionStatus) {
  if (connectionStatus === status) return; // Avoid duplicate notifications
  connectionStatus = status;
  statusListeners.forEach((listener) => {
    try {
      listener(status);
    } catch (err) {
      console.error("Error in connection status listener:", err);
    }
  });
}

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      tryAllTransports: true,
      path: "/socket.io/",
      withCredentials: true,
      // Reconnection configuration
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    // Track connection status
    socket.on("connect", () => {
      clearTimeout(reconnectTimer);
      setStatus("connected");
    });

    socket.on("disconnect", (reason) => {
      // If the server closed the connection or transport was closed,
      // socket.io will auto-reconnect → mark as reconnecting immediately
      if (reason === "io server disconnect") {
        // Server forced disconnect — won't auto-reconnect, try manually
        setStatus("disconnected");
        socket?.connect();
      } else {
        // All other reasons (transport close, ping timeout) → auto-reconnect
        setStatus("reconnecting");
      }
    });

    socket.io.on("reconnect_attempt", () => {
      setStatus("reconnecting");
    });

    socket.io.on("reconnect_failed", () => {
      setStatus("disconnected");
    });

    socket.on("connect_error", (error) => {
      console.error("🔴 Socket connection error:", error.message);
      clearTimeout(reconnectTimer);

      if (error.message === "Authentication unavailable") {
        setStatus("reconnecting");
        reconnectTimer = setTimeout(() => socket?.connect(), 5000);
        return;
      }

      // The server rejects the handshake with these exact messages when the
      // auth cookie is missing or expired (backend src/index.ts io.use).
      // Retrying can never succeed — tell the user to log in again instead of
      // showing an endless "reconnecting" banner.
      if (
        error.message === "Authentication required" ||
        error.message === "Invalid or expired token"
      ) {
        socket?.disconnect();
        setStatus("disconnected");
        toast.error("Sessione scaduta. Accedi di nuovo per continuare.", {
          id: "socket-auth-expired",
          action: {
            label: "Accedi",
            onClick: () => {
              window.location.href = "/";
            },
          },
        });
      } else {
        setStatus(socket?.active ? "reconnecting" : "disconnected");
      }
    });

    socket.on("error", ({ message }) => {
      toast.error(message);
    });
  }

  return socket;
}

export function getConnectionStatus(): ConnectionStatus {
  // If socket exists and is connected but status is stale, correct it
  if (socket?.connected && connectionStatus !== "connected") {
    connectionStatus = "connected";
  }
  return connectionStatus;
}

export function onConnectionStatusChange(
  listener: (status: ConnectionStatus) => void,
): () => void {
  statusListeners.add(listener);
  // Return unsubscribe function
  return () => {
    statusListeners.delete(listener);
  };
}

export function disconnectSocket() {
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.disconnect();
    socket = null;
    setStatus("disconnected");
  }
}
