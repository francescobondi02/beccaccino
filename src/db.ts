// src/db.ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
  // Query-level logging only in development: in tests, queries fired by stray
  // turn timers after Jest teardown would fail the run ("Cannot log after
  // tests are done") even with every test passing.
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : [{ emit: "stdout", level: "error" }],
});
