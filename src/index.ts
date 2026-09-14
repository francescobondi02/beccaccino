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
import { reconcileActiveRuntime } from "./runtime/recovery";
import {
  startRuntimeReconciler,
  stopRuntimeReconciler,
} from "./runtime/reconciler";

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

async function start(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    const recovery = await reconcileActiveRuntime();
    logger.info(recovery, "active_runtime_recovery_complete");
    startRuntimeReconciler();
    startMetrics();
    startPracticeRoomSweeper();
  }
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    httpServer.once("error", onError);
    httpServer.listen(port, () => {
      httpServer.off("error", onError);
      resolve();
    });
  });
  logger.info({ port }, "server_started");
}

void start().catch(async (error) => {
  logger.fatal({ err: error }, "server_start_failed");
  stopMetrics();
  await stopRuntimeReconciler();
  await stopPracticeRoomSweeper();
  if (httpServer.listening) await close();
  await prisma.$disconnect();
  process.exit(1);
});

let isShuttingDown = false;
const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "shutdown_initiated");

  stopMetrics();
  await stopRuntimeReconciler();
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
