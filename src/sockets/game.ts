// src/sockets/game.ts
import { Server, Socket } from "socket.io";

export function registerGameSocket(socket: Socket, io: Server) {
  socket.on("join-game", (data) => {
    console.log(`${socket.id} joined game with`, data);
    socket.join(data.roomId);
    io.to(data.roomId).emit("player-joined", { id: socket.id });
  });

  socket.on("play-card", (data) => {
    console.log("card played:", data);
    io.to(data.roomId).emit("card-played", data);
  });
}
