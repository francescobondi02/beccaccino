import { describe, expect, it } from "vitest";
import {
  initialWaitingRoomState,
  waitingRoomReducer,
  waitingRoomSlots,
} from "@/rooms/waitingRoomState";

const room = {
  id: 1,
  code: "ROOM01",
  started: false,
  finished: false,
  isPractice: false,
  players: [
    {
      id: 10,
      userId: 2,
      username: "bob",
      seat: 1,
      team: null,
      isReady: false,
    },
    {
      id: 11,
      userId: 1,
      username: "alice",
      seat: 0,
      team: 0,
      isReady: false,
    },
  ],
};

describe("waitingRoomReducer", () => {
  it("hydrates and updates the same player collection", () => {
    const loaded = waitingRoomReducer(initialWaitingRoomState, {
      type: "room_loaded",
      room,
    });
    const withTeam = waitingRoomReducer(loaded, {
      type: "team_chosen",
      userId: 2,
      team: 1,
    });
    const ready = waitingRoomReducer(withTeam, {
      type: "ready_changed",
      userId: 2,
      isReady: true,
    });

    expect(ready.room?.players[0]).toMatchObject({
      userId: 2,
      team: 1,
      isReady: true,
    });
  });

  it("ignores duplicate joins and removes departed players", () => {
    const loaded = waitingRoomReducer(initialWaitingRoomState, {
      type: "room_loaded",
      room,
    });
    const duplicate = waitingRoomReducer(loaded, {
      type: "player_joined",
      player: room.players[0],
    });
    const departed = waitingRoomReducer(duplicate, {
      type: "player_left",
      userId: 2,
    });

    expect(duplicate).toBe(loaded);
    expect(departed.room?.players.map((player) => player.userId)).toEqual([1]);
  });
});

describe("waitingRoomSlots", () => {
  it("places the current user first and pads four stable slots", () => {
    const slots = waitingRoomSlots(room, 1);

    expect(slots).toHaveLength(4);
    expect(slots[0]?.username).toBe("alice");
    expect(slots[1]?.username).toBe("bob");
    expect(slots.slice(2)).toEqual([null, null]);
  });
});
