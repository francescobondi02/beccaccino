// src/app.ts
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import userRouter from "./routes/users";
import roomRouter from "./routes/rooms";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/users", userRouter);
app.use("/api/rooms", roomRouter);

export default app;
