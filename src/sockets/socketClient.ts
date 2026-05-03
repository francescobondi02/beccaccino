// src/sockets/socketClient.ts
import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000";

let socket: Socket | null = null;

// Connection status tracking
type ConnectionStatus = "connected" | "disconnected" | "reconnecting";
let connectionStatus: ConnectionStatus = "disconnected";
const statusListeners: Set<(status: ConnectionStatus) => void> = new Set();

function notifyStatusListeners(status: ConnectionStatus) {
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
      console.log("🟢 Socket connected:", socket?.id);
      notifyStatusListeners("connected");
    });

    socket.on("disconnect", (reason) => {
      console.log("🔴 Socket disconnected:", reason);
      notifyStatusListeners("disconnected");
    });

    socket.io.on("reconnect_attempt", (attempt) => {
      console.log(`🟡 Socket reconnecting... attempt ${attempt}`);
      notifyStatusListeners("reconnecting");
    });

    socket.io.on("reconnect", (attempt) => {
      console.log(`🟢 Socket reconnected after ${attempt} attempts`);
      notifyStatusListeners("connected");
    });

    socket.io.on("reconnect_failed", () => {
      console.log("🔴 Socket reconnection failed permanently");
      notifyStatusListeners("disconnected");
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
  return connectionStatus;
}

export function onConnectionStatusChange(
  listener: (status: ConnectionStatus) => void
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
    notifyStatusListeners("disconnected");
  }
}
