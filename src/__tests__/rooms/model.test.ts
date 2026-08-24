import { describe, expect, it } from "vitest";
import { normalizeRoom } from "@/rooms/model";

describe("normalizeRoom", () => {
  it("normalizes nested API users once for page consumers", () => {
    const room = normalizeRoom({
      id: 1,
      code: "ROOM",
      started: false,
      finished: false,
      players: [
        {
          id: 10,
          userId: 20,
          seat: 0,
          team: null,
          isReady: false,
          user: { username: "alice" },
        },
      ],
    });

    expect(room.players[0]).toEqual({
      id: 10,
      userId: 20,
      username: "alice",
      seat: 0,
      team: null,
      isReady: false,
    });
  });

  it("preserves a direct username from an already-flat response", () => {
    const room = normalizeRoom({
      id: 1,
      code: "ROOM",
      started: true,
      finished: false,
      players: [
        {
          id: 10,
          userId: 20,
          username: "alice",
          seat: 0,
          team: 1,
          isReady: true,
        },
      ],
    });

    expect(room.players[0].username).toBe("alice");
  });

  it("uses a stable fallback when the API omits a username", () => {
    const room = normalizeRoom({
      id: 1,
      code: "ROOM",
      started: false,
      finished: false,
      players: [
        {
          id: 10,
          userId: 20,
          seat: null,
          team: null,
          isReady: false,
        },
      ],
    });

    expect(room.players[0].username).toBe("Sconosciuto");
  });
});
