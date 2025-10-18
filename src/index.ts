// src/index.ts
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

import { registerGameSocket } from "./sockets/game";
import userRouter from "./routes/users";
import roomRouter from "./routes/rooms";
import gameRouter from "./routes/games";
import cookieParser from "cookie-parser";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// CORS configuration per permettere cookies
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:8081",
    credentials: true, // Permette invio cookies
  })
);

app.use(express.json());
app.use(cookieParser()); // Parse cookies

app.use("/api/users", userRouter);
app.use("/api/rooms", roomRouter);
app.use("/api/games", gameRouter);

// WebSocket logic
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  registerGameSocket(socket, io);
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
