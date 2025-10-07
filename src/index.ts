// src/index.ts
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

import { registerGameSocket } from "./sockets/game";
import userRouter from "./routes/users";
import roomRouter from "./routes/rooms";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use("/api/users", userRouter);
app.use("/api/rooms", roomRouter);

// WebSocket logic
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  registerGameSocket(socket, io);
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
