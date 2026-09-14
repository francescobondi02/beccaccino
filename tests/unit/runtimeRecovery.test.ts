import {
  startRuntimeReconciler,
  stopRuntimeReconciler,
} from "../../src/runtime/reconciler";
import {
  recoverRooms,
  RuntimeRecoverySummary,
} from "../../src/runtime/recovery";

const emptySummary: RuntimeRecoverySummary = {
  activeRooms: 0,
  recoveredRooms: 0,
  failedRoomCodes: [],
};

describe("runtime recovery", () => {
  afterEach(async () => {
    await stopRuntimeReconciler();
    jest.useRealTimers();
  });

  it("isolates a failed room and continues recovering the remaining rooms", async () => {
    const recover = jest.fn(async (roomCode: string) => {
      if (roomCode === "ROOM02") throw new Error("database read failed");
      return roomCode === "ROOM03";
    });

    await expect(
      recoverRooms(["ROOM01", "ROOM02", "ROOM03"], recover),
    ).resolves.toEqual({
      activeRooms: 3,
      recoveredRooms: 1,
      failedRoomCodes: ["ROOM02"],
    });
    expect(recover.mock.calls).toEqual([
      ["ROOM01"],
      ["ROOM02"],
      ["ROOM03"],
    ]);
  });

  it("does not overlap periodic reconciliation runs", async () => {
    jest.useFakeTimers();
    let finish!: (summary: RuntimeRecoverySummary) => void;
    const reconcile = jest.fn(
      () =>
        new Promise<RuntimeRecoverySummary>((resolve) => {
          finish = resolve;
        }),
    );
    startRuntimeReconciler({ intervalMs: 100, reconcile });

    jest.advanceTimersByTime(300);
    expect(reconcile).toHaveBeenCalledTimes(1);

    finish(emptySummary);
    await jest.advanceTimersByTimeAsync(100);

    expect(reconcile).toHaveBeenCalledTimes(2);
    finish(emptySummary);
  });
});
