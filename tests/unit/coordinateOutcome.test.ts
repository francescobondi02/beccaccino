import { coordinateOutcome } from "../../src/game/coordinateOutcome";
import { TransitionOutcome } from "../../src/game/transitions/types";

const outcome: TransitionOutcome<string> = {
  value: "committed",
  runtime: {
    kind: "schedule",
    roomCode: "ROOM01",
    userId: 7,
    phase: "play_card",
    pauseEpoch: 2,
  },
  events: [
    { target: "ROOM01", event: "card_played", payload: { position: 1 } },
  ],
};

describe("coordinateOutcome", () => {
  it("applies runtime before publishing committed events", async () => {
    const calls: string[] = [];

    await expect(
      coordinateOutcome(outcome, {
        applyRuntime: () => calls.push("runtime"),
        publishEvents: () => {
          calls.push("events");
        },
      }),
    ).resolves.toBe("committed");

    expect(calls).toEqual(["runtime", "events"]);
  });

  it("returns the committed value when publication fails", async () => {
    const applyRuntime = jest.fn();

    await expect(
      coordinateOutcome(outcome, {
        applyRuntime,
        publishEvents: () => {
          throw new Error("socket unavailable");
        },
      }),
    ).resolves.toBe("committed");

    expect(applyRuntime).toHaveBeenCalledWith(outcome.runtime);
  });

  it("does not publish when runtime application fails", async () => {
    const publishEvents = jest.fn();

    await expect(
      coordinateOutcome(outcome, {
        applyRuntime: () => {
          throw new Error("runtime unavailable");
        },
        publishEvents,
      }),
    ).rejects.toThrow("runtime unavailable");

    expect(publishEvents).not.toHaveBeenCalled();
  });
});
