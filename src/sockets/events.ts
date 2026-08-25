// src/sockets/events.ts
/**
 * Single typed Socket.IO contract for the client.
 *
 * The BACKEND is the source of truth: every payload here mirrors exactly what
 * the server emits (see backend gameService.ts / turnTimer.ts / room.ts /
 * roomController.ts / chooseTeam.ts) or what the server handlers expect.
 * Reserved socket.io events (connect / disconnect / connect_error) are provided
 * by the library and must NOT be declared here.
 */

import type { Signal } from "@/game/model";
import type { RoomPlayer } from "@/rooms/model";

export type { Signal };
export type Phase = "play_card" | "choose_briscola";

export type Player = RoomPlayer;

export interface LobbyRoom {
  id: number;
  code: string;
  currentPlayers: number;
  maxPlayers: number;
}

export interface TeamScore {
  points: number;
  figures: number;
}

// --- Server -> client payloads ---

export interface RoomCreatedPayload {
  room: LobbyRoom;
}
export interface RoomUpdatedPayload {
  roomCode: string;
  currentPlayers: number;
}
export interface RoomCodePayload {
  roomCode: string;
}
export interface PlayerJoinedPayload {
  player: Player;
}
export interface PlayerLeftPayload {
  userId: number;
}
export interface PlayerDisconnectedPayload {
  userId: number;
  username: string;
}
// playerId is only present on the deprecated socket path; the authoritative
// REST path omits it.
export interface TeamChosenPayload {
  userId: number;
  team: number;
  playerId?: number;
}
export interface ReadyChangedPayload {
  userId: number;
  isReady: boolean;
  playerId?: number;
}
export interface BriscolaChosenPayload {
  briscola: string;
  roundNumber: number;
  starterId: number;
  cricca: boolean;
}
export interface CardPlayedPayload {
  playerId: number;
  userId: number;
  suit: string;
  value: string;
  position: number;
  handNumber: number;
  signal: Signal | null;
}
export interface RoundEndedPayload {
  roundNumber: number;
  team0: TeamScore;
  team1: TeamScore;
  winnerTeam: number;
  cricca: boolean;
}
export interface GameFinishedPayload {
  winnerTeam: number;
  totalRounds: number;
  finalScores: { team0: number; team1: number };
  roundsWon: { team0: number; team1: number };
}
export interface NewRoundStartedPayload {
  roundId: number;
  roundNumber: number;
  callerUserId: number | null;
}
// totalMs is null for bot turns (no deadline to count down to).
export interface TurnTimerStartedPayload {
  turnUserId: number;
  totalMs: number | null;
  serverTimestamp: number;
  phase: Phase;
  isBot: boolean;
}
export interface AutoPlayedPayload {
  userId: number;
  phase: Phase;
}
export interface PlayerKickedTimeoutPayload {
  userId: number;
  username: string;
}
export interface ChatMessagePayload {
  userId: number;
  username: string;
  message: string;
  timestamp: string;
}
export interface ErrorPayload {
  message: string;
}
export interface JoinRoomResult {
  ok: boolean;
  error?: string;
}

export interface ServerToClientEvents {
  room_created: (payload: RoomCreatedPayload) => void;
  room_updated: (payload: RoomUpdatedPayload) => void;
  room_full: (payload: RoomCodePayload) => void;
  room_deleted: (payload: RoomCodePayload) => void;
  player_joined: (payload: PlayerJoinedPayload) => void;
  player_left: (payload: PlayerLeftPayload) => void;
  player_disconnected: (payload: PlayerDisconnectedPayload) => void;
  team_chosen: (payload: TeamChosenPayload) => void;
  ready_changed: (payload: ReadyChangedPayload) => void;
  game_started: () => void;
  new_round_started: (payload: NewRoundStartedPayload) => void;
  briscola_chosen: (payload: BriscolaChosenPayload) => void;
  card_played: (payload: CardPlayedPayload) => void;
  round_ended: (payload: RoundEndedPayload) => void;
  game_finished: (payload: GameFinishedPayload) => void;
  turn_timer_started: (payload: TurnTimerStartedPayload) => void;
  auto_played: (payload: AutoPlayedPayload) => void;
  player_kicked_timeout: (payload: PlayerKickedTimeoutPayload) => void;
  practice_abandoned: (payload: RoomCodePayload) => void;
  chat_message: (payload: ChatMessagePayload) => void;
  error: (payload: ErrorPayload) => void;
}

// --- Client -> server payloads ---

export interface ClientToServerEvents {
  join_lobby: (payload: { userId: number }) => void;
  leave_lobby: () => void;
  join_room: (
    payload: {
      roomCode: string;
      userId: number;
      username: string;
    },
    acknowledge: (result: JoinRoomResult) => void,
  ) => void;
  leave_room: (payload: { roomCode: string }) => void;
  choose_team: (payload: {
    roomCode: string;
    userId: number;
    team: number;
  }) => void;
  set_ready: (payload: {
    roomCode: string;
    userId: number;
    isReady: boolean;
  }) => void;
  send_chat_message: (payload: { roomCode?: string; message: string }) => void;
}
