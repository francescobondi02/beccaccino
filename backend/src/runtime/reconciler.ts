import { logger } from "../logger";
import {
  reconcileActiveRuntime,
  RuntimeRecoverySummary,
} from "./recovery";

type ReconcileRuntime = () => Promise<RuntimeRecoverySummary>;

let reconcileTimer: NodeJS.Timeout | null = null;
let reconcileRun: Promise<void> | null = null;

export function startRuntimeReconciler(
  options: {
    intervalMs?: number;
    reconcile?: ReconcileRuntime;
  } = {},
): void {
  if (reconcileTimer) return;

  const intervalMs =
    options.intervalMs ??
    parseInt(process.env.RUNTIME_RECONCILE_INTERVAL_MS || "30000", 10);
  const reconcile = options.reconcile ?? reconcileActiveRuntime;
  reconcileTimer = setInterval(() => {
    if (reconcileRun) return;
    reconcileRun = reconcile()
      .then((summary) => {
        if (summary.failedRoomCodes.length > 0) {
          logger.warn(summary, "active_runtime_reconcile_incomplete");
        } else if (summary.recoveredRooms > 0) {
          logger.info(summary, "active_runtime_reconcile_complete");
        }
      })
      .catch((error) => {
        logger.error({ err: error }, "active_runtime_reconcile_failed");
      })
      .finally(() => {
        reconcileRun = null;
      });
  }, intervalMs);
  reconcileTimer.unref();
}

export async function stopRuntimeReconciler(): Promise<void> {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  await reconcileRun;
}
