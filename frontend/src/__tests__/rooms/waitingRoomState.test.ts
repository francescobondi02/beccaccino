import { describe, expect, it } from "vitest";
import type { Room, RoomPlayer } from "@contract/rooms";
import { waitingRoomSlots } from "@/rooms/waitingRoomState";

const player = (userId: number, username: string, team: RoomPlayer["team"]): RoomPlayer => ({
  id: userId + 9, userId, seat: null, team, isReady: false, botModel: null,
  abandonedAt: null, user: { id: userId, username },
});
const room: Room = {
  id: 1,
  code: "ROOM01",
  started: false,
  finished: false,
  isPractice: false,
  botTier: null,
  pausedAt: null,
  players: [player(2, "bob", null), player(1, "alice", 0)],
};

describe("waitingRoomSlots", () => {
  it("places the current user first and pads four stable slots", () => {
    const slots = waitingRoomSlots(room, 1);

    expect(slots).toHaveLength(4);
    expect(slots[0]).toMatchObject({ user: { username: "alice" } });
    expect(slots[1]).toMatchObject({ user: { username: "bob" } });
    expect(slots.slice(2)).toEqual([null, null]);
  });

  it("previews bots in missing teams without adding room members", () => {
    const mixed = {
      ...room,
      botTier: "forte" as const,
      players: room.players.map((player) => ({ ...player, team: 0 as const })),
    };

    expect(waitingRoomSlots(mixed, 1).slice(2)).toEqual([
      { isBotPlaceholder: true, team: 1 },
      { isBotPlaceholder: true, team: 1 },
    ]);
    expect(mixed.players).toHaveLength(2);
  });

  it("keeps placeholder teams undecided until every human chooses", () => {
    expect(waitingRoomSlots({ ...room, botTier: "medio" }, 1).slice(2)).toEqual([
      { isBotPlaceholder: true, team: null },
      { isBotPlaceholder: true, team: null },
    ]);
  });
});
