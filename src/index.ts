import dotenv from "dotenv";
dotenv.config();

import "./instrument";

import { prisma } from "./db";
import { logger } from "./logger";
import { createServer } from "./server";
import { startMetrics, stopMetrics } from "./services/metrics";
import {
  startPracticeRoomSweeper,
  stopPracticeRoomSweeper,
} from "./services/practiceRoomSweeper";
import { recoverActiveRuntime } from "./runtime/recovery";

const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.fatal({ envVar: key }, "missing_required_env_var");
    process.exit(1);
  }
}

if (process.env.NODE_ENV === "production" && !process.env.FRONTEND_URL) {
  logger.fatal("FRONTEND_URL is required in production");
  process.exit(1);
}

const { httpServer, close } = createServer();
const port = process.env.PORT ? Number(process.env.PORT) : 8000;
httpServer.listen(port, async () => {
  logger.info({ port }, "server_started");
  if (process.env.NODE_ENV !== "test") {
    startMetrics();
    startPracticeRoomSweeper();
    try {
      const recoveredRooms = await recoverActiveRuntime();
      logger.info({ recoveredRooms }, "active_runtime_recovery_complete");
    } catch (error) {
      logger.error({ err: error }, "active_runtime_recovery_failed");
    }
  }
});

let isShuttingDown = false;
const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "shutdown_initiated");

  stopMetrics();
  await stopPracticeRoomSweeper();
  let exitCode = 0;
  try {
    await close();
  } catch (error) {
    exitCode = 1;
    logger.error({ err: error }, "server_close_failed");
  }
  try {
    await prisma.$disconnect();
  } catch (error) {
    exitCode = 1;
    logger.error({ err: error }, "prisma_disconnect_failed");
  } finally {
    logger.info({ exitCode }, "shutdown_complete");
    process.exit(exitCode);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled_rejection");
});
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "uncaught_exception");
  process.exit(1);
});
