import { describe, expect, it } from "vitest";
import type { Room } from "@contract/rooms";
import { splitActiveGames } from "@/rooms/lobbyState";

describe("splitActiveGames", () => {
  it("separates only paused practice games", () => {
    const paused: Room = {
      id: 1,
      code: "PAUSED",
      started: true,
      finished: false,
      isPractice: true,
      botTier: "medio",
      pausedAt: "2026-08-28T10:00:00.000Z",
      players: [],
    };
    const activePractice = {
      ...paused,
      id: 2,
      code: "ACTIVE",
      pausedAt: null,
    };
    const multiplayer = {
      ...paused,
      id: 3,
      code: "MULTI1",
      isPractice: false,
    };

    expect(splitActiveGames([paused, activePractice, multiplayer])).toEqual({
      pausedPracticeGames: [paused],
      ordinaryActiveGames: [activePractice, multiplayer],
    });
  });
});
