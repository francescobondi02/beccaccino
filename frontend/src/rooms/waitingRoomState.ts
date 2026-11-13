import {
  normalizeRoom,
  type Room,
  type RoomPlayer,
  type RoomResponse,
} from "@/rooms/model";

export interface WaitingRoomState {
  room: Room | null;
  isLoading: boolean;
  gameStarted: boolean;
}

export type WaitingRoomAction =
  | { type: "loading_started" }
  | { type: "loading_finished" }
  | { type: "room_loaded"; room: RoomResponse }
  | { type: "player_joined"; player: RoomPlayer }
  | { type: "player_left"; userId: number }
  | { type: "team_chosen"; userId: number; team: number }
  | { type: "ready_changed"; userId: number; isReady: boolean }
  | { type: "game_started" };

export const initialWaitingRoomState: WaitingRoomState = {
  room: null,
  isLoading: true,
  gameStarted: false,
};

function updatePlayer(
  room: Room | null,
  userId: number,
  update: (player: RoomPlayer) => RoomPlayer,
): Room | null {
  if (!room) return room;
  return {
    ...room,
    players: room.players.map((player) =>
      player.userId === userId ? update(player) : player,
    ),
  };
}

export function waitingRoomReducer(
  state: WaitingRoomState,
  action: WaitingRoomAction,
): WaitingRoomState {
  switch (action.type) {
    case "loading_started":
      return { ...state, isLoading: true };
    case "loading_finished":
      return { ...state, isLoading: false };
    case "room_loaded":
      return {
        ...state,
        room: normalizeRoom(action.room),
        isLoading: false,
      };
    case "player_joined":
      if (
        !state.room ||
        state.room.players.some(
          (player) => player.userId === action.player.userId,
        )
      ) {
        return state;
      }
      return {
        ...state,
        room: {
          ...state.room,
          players: [...state.room.players, action.player],
        },
      };
    case "player_left":
      if (!state.room) return state;
      return {
        ...state,
        room: {
          ...state.room,
          players: state.room.players.filter(
            (player) => player.userId !== action.userId,
          ),
        },
      };
    case "team_chosen":
      return {
        ...state,
        room: updatePlayer(state.room, action.userId, (player) => ({
          ...player,
          team: action.team,
        })),
      };
    case "ready_changed":
      return {
        ...state,
        room: updatePlayer(state.room, action.userId, (player) => ({
          ...player,
          isReady: action.isReady,
        })),
      };
    case "game_started":
      return { ...state, gameStarted: true };
  }
}

export type WaitingRoomSlot =
  | RoomPlayer
  | { isBotPlaceholder: true; team: number | null }
  | null;

export function waitingRoomSlots(
  room: Room | null,
  currentUserId: number | null,
): WaitingRoomSlot[] {
  const players = [...(room?.players ?? [])].sort((left, right) => {
    if (left.userId === currentUserId) return -1;
    if (right.userId === currentUserId) return 1;
    return left.username.localeCompare(right.username);
  });

  const slots: WaitingRoomSlot[] = [...players];
  const teams = players.every((player) => player.team !== null)
    ? [0, 1].flatMap((team) =>
        Array.from(
          { length: 2 - players.filter((player) => player.team === team).length },
          () => team,
        ),
      )
    : [];
  while (slots.length < 4) {
    slots.push(
      room?.botTier
        ? { isBotPlaceholder: true, team: teams.shift() ?? null }
        : null,
    );
  }
  return slots;
}
