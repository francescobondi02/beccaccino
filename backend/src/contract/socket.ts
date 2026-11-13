import type { GameState } from "./game";

export type RoomCodePayload = { roomCode: string };
export type ChatMessagePayload = {
  userId: number;
  username: string;
  message: string;
  timestamp: string;
};
export type JoinRoomResult = { ok: boolean; error?: string };

export type ServerToClientEvents = {
  // Sent to `user:<id>` of every human player still in the game.
  game_state: (state: GameState) => void;
  // Sent to the socket room named by the room code.
  room_changed: (payload: RoomCodePayload) => void;
  // Sent to the `lobby` socket room.
  lobby_changed: (payload: RoomCodePayload) => void;
  chat_message: (payload: ChatMessagePayload) => void;
  player_disconnected: (payload: { userId: number; username: string }) => void;
  error: (payload: { message: string }) => void;
};

export type ClientToServerEvents = {
  join_lobby: () => void;
  leave_lobby: () => void;
  join_room: (payload: RoomCodePayload, acknowledge: (result: JoinRoomResult) => void) => void;
  leave_room: (payload: RoomCodePayload) => void;
  send_chat_message: (payload: { message: string }) => void;
};
