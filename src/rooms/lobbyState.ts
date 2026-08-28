import type { LobbyRoom as SocketLobbyRoom } from "@/sockets/events";

export interface LobbyRoomPlayer {
  id: number;
  userId: number;
  user?: {
    id: number;
    username: string;
  };
}

export interface LobbyRoom extends SocketLobbyRoom {
  isPractice?: boolean;
  pausedAt?: string | null;
  players?: LobbyRoomPlayer[];
}

interface LobbyRoomResponse {
  id: number;
  code: string;
  players?: LobbyRoomPlayer[];
}

interface ActiveGameResponse extends LobbyRoomResponse {
  isPractice: boolean;
  pausedAt: string | null;
}

export interface LobbyRoomsResponse {
  availableRooms: LobbyRoomResponse[];
  activeGames: ActiveGameResponse[];
}

export interface LobbyRoomsState {
  availableRooms: LobbyRoom[];
  activeGames: LobbyRoom[];
  isLoading: boolean;
}

export type LobbyRoomsAction =
  | { type: "loading_started" }
  | { type: "loading_finished" }
  | { type: "rooms_loaded"; data: LobbyRoomsResponse }
  | { type: "rooms_cleared" }
  | { type: "available_room_created"; room: SocketLobbyRoom }
  | {
      type: "available_room_updated";
      roomCode: string;
      currentPlayers: number;
    }
  | { type: "available_room_removed"; roomCode: string }
  | { type: "practice_paused"; roomCode: string; pausedAt: string }
  | { type: "practice_resumed"; roomCode: string }
  | { type: "practice_abandoned"; roomCode: string };

export const initialLobbyRoomsState: LobbyRoomsState = {
  availableRooms: [],
  activeGames: [],
  isLoading: false,
};

function toLobbyRoom(room: LobbyRoomResponse): LobbyRoom {
  return {
    id: room.id,
    code: room.code,
    currentPlayers: room.players?.length ?? 0,
    maxPlayers: 4,
    players: room.players,
  };
}

export function lobbyRoomsReducer(
  state: LobbyRoomsState,
  action: LobbyRoomsAction,
): LobbyRoomsState {
  switch (action.type) {
    case "loading_started":
      return { ...state, isLoading: true };
    case "loading_finished":
      return { ...state, isLoading: false };
    case "rooms_loaded":
      return {
        availableRooms: action.data.availableRooms.map(toLobbyRoom),
        activeGames: action.data.activeGames.map((room) => ({
          ...toLobbyRoom(room),
          isPractice: room.isPractice,
          pausedAt: room.pausedAt,
        })),
        isLoading: false,
      };
    case "rooms_cleared":
      return initialLobbyRoomsState;
    case "available_room_created":
      return {
        ...state,
        availableRooms: [...state.availableRooms, action.room],
      };
    case "available_room_updated":
      return {
        ...state,
        availableRooms: state.availableRooms.map((room) =>
          room.code === action.roomCode
            ? { ...room, currentPlayers: action.currentPlayers }
            : room,
        ),
      };
    case "available_room_removed":
      return {
        ...state,
        availableRooms: state.availableRooms.filter(
          (room) => room.code !== action.roomCode,
        ),
      };
    case "practice_paused":
      return {
        ...state,
        activeGames: state.activeGames.map((room) =>
          room.code === action.roomCode
            ? { ...room, pausedAt: action.pausedAt }
            : room,
        ),
      };
    case "practice_resumed":
      return {
        ...state,
        activeGames: state.activeGames.map((room) =>
          room.code === action.roomCode ? { ...room, pausedAt: null } : room,
        ),
      };
    case "practice_abandoned":
      return {
        ...state,
        activeGames: state.activeGames.filter(
          (room) => room.code !== action.roomCode,
        ),
      };
  }
}

export function splitActiveGames(activeGames: LobbyRoom[]) {
  const pausedPracticeGames: LobbyRoom[] = [];
  const ordinaryActiveGames: LobbyRoom[] = [];

  activeGames.forEach((game) => {
    if (game.isPractice && game.pausedAt) {
      pausedPracticeGames.push(game);
    } else {
      ordinaryActiveGames.push(game);
    }
  });

  return { pausedPracticeGames, ordinaryActiveGames };
}
