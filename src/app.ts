// src/app.ts
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

import userRouter from "./routes/users";
import roomRouter from "./routes/rooms";
import gameRouter from "./routes/games";

dotenv.config();

const app = express();

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

export default app;
