// src/app.ts
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import userRouter from "./routes/users";
import roomRouter from "./routes/rooms";
import gameRouter from "./routes/games";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/users", userRouter);
app.use("/api/rooms", roomRouter);
app.use("/api/games", gameRouter);

export default app;
