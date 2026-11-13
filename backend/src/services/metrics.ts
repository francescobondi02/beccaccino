// Lightweight ops metrics. Emits a periodic JSON log line so Render's log
// search can answer "how busy were we at 14:00?" without standing up a full
// metrics stack. If/when traffic grows, swap this for prom-client or
// OTel without touching the call sites.

import { logger } from "../logger";
import { getSocketInstance } from "../socketInstance";
import { prisma } from "../db";
import { LIVE_MULTIPLAYER_ROOM, OPEN_LOBBY } from "../utils/statsFilters";

const METRICS_INTERVAL_MS = 60_000; // every minute
let interval: NodeJS.Timeout | null = null;

async function emitMetrics() {
  let connectedSockets = 0;
  try {
    const io = getSocketInstance();
    // io.engine.clientsCount is the cheapest way to count live connections
    // without iterating the namespace. Fall back to 0 if not initialized.
    connectedSockets = (io.engine as { clientsCount?: number })?.clientsCount ?? 0;
  } catch {
    // Socket not yet ready (boot or test) — skip the socket count, still
    // emit DB-derived metrics so we have something.
  }

  let activeGames = 0;
  let openRooms = 0;
  try {
    [activeGames, openRooms] = await Promise.all([
      prisma.gameRoom.count({ where: LIVE_MULTIPLAYER_ROOM }),
      prisma.gameRoom.count({ where: OPEN_LOBBY }),
    ]);
  } catch (err) {
    logger.warn({ err }, "metrics_db_query_failed");
    return;
  }

  const mem = process.memoryUsage();

  logger.info(
    {
      metric: "ops_snapshot",
      connectedSockets,
      activeGames,
      openRooms,
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      uptimeSec: Math.round(process.uptime()),
    },
    "ops_snapshot",
  );
}

export function startMetrics() {
  if (interval) return;
  interval = setInterval(emitMetrics, METRICS_INTERVAL_MS);
  // Don't keep the event loop alive just for metrics.
  interval.unref();
}

export function stopMetrics() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
