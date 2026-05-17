// src/sockets/socketClient.ts
import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000";

let socket: Socket | null = null;

// Connection status tracking
type ConnectionStatus = "connected" | "disconnected" | "reconnecting";
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

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
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

    socket.io.on("reconnect_attempt", (attempt) => {
      setStatus("reconnecting");
    });

    socket.io.on("reconnect", (attempt) => {
      setStatus("connected");
    });

    socket.io.on("reconnect_failed", () => {
      setStatus("disconnected");
    });

    socket.on("connect_error", (error) => {
      console.error("🔴 Socket connection error:", error.message);
    });
  }

  return socket;
}

export function isSocketConnected(): boolean {
  return socket ? socket.connected : false;
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
  if (socket) {
    socket.disconnect();
    socket = null;
    setStatus("disconnected");
  }
}
