// src/socketInstance.ts
import { Server } from "socket.io";

let io: Server;

export const setSocketInstance = (serverInstance: Server) => {
  io = serverInstance;
};

export const getSocketInstance = (): Server => {
  if (!io) {
    throw new Error("Socket.io instance not initialized");
  }
  return io;
};
