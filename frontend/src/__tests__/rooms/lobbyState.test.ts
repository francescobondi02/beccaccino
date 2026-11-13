import { describe, expect, it } from "vitest";
import {
  initialLobbyRoomsState,
  lobbyRoomsReducer,
  splitActiveGames,
} from "@/rooms/lobbyState";

describe("lobbyRoomsReducer", () => {
  const loadedState = lobbyRoomsReducer(initialLobbyRoomsState, {
    type: "rooms_loaded",
    data: {
      availableRooms: [
        {
          id: 1,
          code: "OPEN01",
          players: [{ id: 10, userId: 20 }],
        },
      ],
      activeGames: [
        {
          id: 2,
          code: "PLAY01",
          players: [],
          isPractice: true,
          pausedAt: null,
        },
      ],
    },
  });

  it("normalizes loaded room counts and lifecycle fields", () => {
    expect(loadedState).toEqual({
      availableRooms: [
        {
          id: 1,
          code: "OPEN01",
          currentPlayers: 1,
          maxPlayers: 4,
          players: [{ id: 10, userId: 20 }],
        },
      ],
      activeGames: [
        {
          id: 2,
          code: "PLAY01",
          currentPlayers: 0,
          maxPlayers: 4,
          players: [],
          isPractice: true,
          pausedAt: null,
        },
      ],
      isLoading: false,
    });
  });

  it.each([
    {
      action: {
        type: "practice_paused" as const,
        roomCode: "PLAY01",
        pausedAt: "2026-08-28T10:00:00.000Z",
      },
      pausedAt: "2026-08-28T10:00:00.000Z",
    },
    {
      action: {
        type: "practice_resumed" as const,
        roomCode: "PLAY01",
      },
      pausedAt: null,
    },
  ])("$action.type updates the matching active game", ({ action, pausedAt }) => {
    const state = lobbyRoomsReducer(loadedState, action);

    expect(state.activeGames[0].pausedAt).toBe(pausedAt);
    expect(state.availableRooms).toBe(loadedState.availableRooms);
  });

  it("applies live room creation, occupancy and removal", () => {
    const created = lobbyRoomsReducer(loadedState, {
      type: "available_room_created",
      room: { id: 3, code: "NEW001", currentPlayers: 1, maxPlayers: 4 },
    });
    const updated = lobbyRoomsReducer(created, {
      type: "available_room_updated",
      roomCode: "NEW001",
      currentPlayers: 3,
    });
    const removed = lobbyRoomsReducer(updated, {
      type: "available_room_removed",
      roomCode: "OPEN01",
    });

    expect(removed.availableRooms).toEqual([
      { id: 3, code: "NEW001", currentPlayers: 3, maxPlayers: 4 },
    ]);
    expect(removed.activeGames).toBe(loadedState.activeGames);
  });

  it("removes abandoned practice games without changing available rooms", () => {
    const state = lobbyRoomsReducer(loadedState, {
      type: "practice_abandoned",
      roomCode: "PLAY01",
    });

    expect(state.activeGames).toEqual([]);
    expect(state.availableRooms).toBe(loadedState.availableRooms);
  });
});

describe("splitActiveGames", () => {
  it("separates only paused practice games", () => {
    const paused = {
      id: 1,
      code: "PAUSED",
      currentPlayers: 4,
      maxPlayers: 4,
      isPractice: true,
      pausedAt: "2026-08-28T10:00:00.000Z",
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
