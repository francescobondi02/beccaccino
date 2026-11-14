import type { BotTier, Team } from "./cards";

export type RoomPlayer = {
  id: number;
  userId: number;
  seat: number | null;
  team: Team | null;
  isReady: boolean;
  botModel: BotTier | null;
  abandonedAt: string | null;
  user: { id: number; username: string };
};

// GET /api/rooms/:code, POST /api/rooms, POST /api/rooms/:code/join and other room mutations.
export type Room = {
  id: number;
  code: string;
  started: boolean;
  finished: boolean;
  isPractice: boolean;
  botTier: BotTier | null;
  pausedAt: string | null;
  players: RoomPlayer[];
};

// GET /api/rooms/available
export type LobbyRooms = { availableRooms: Room[]; activeGames: Room[] };
