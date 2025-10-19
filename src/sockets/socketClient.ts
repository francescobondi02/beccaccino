// src/sockets/socketClient.ts
import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      path: "/socket.io/",
      withCredentials: true,
    });
  }
  return socket;
}

export function isSocketConnected() {
  return socket ? socket.connected : false;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
