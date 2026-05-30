// src/db.ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
  log:
    process.env.NODE_ENV === "production"
      ? [{ emit: "stdout", level: "error" }]
      : ["query", "error", "warn"],
});
