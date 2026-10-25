export interface RoomPlayerResponse {
  id: number;
  userId: number;
  username?: string;
  seat: number | null;
  team: number | null;
  isReady: boolean;
  botModel?: string | null;
  abandonedAt?: string | null;
  user?: { username?: string };
}

export interface RoomPlayer {
  id: number;
  userId: number;
  username: string;
  seat: number | null;
  team: number | null;
  isReady: boolean;
  botModel?: string | null;
  abandonedAt?: string | null;
}

export interface Room {
  id: number;
  code: string;
  started: boolean;
  finished: boolean;
  isPractice: boolean;
  botTier?: string | null;
  players: RoomPlayer[];
}

export type RoomResponse = Omit<Room, "players"> & {
  players: RoomPlayerResponse[];
};

export function normalizeRoomPlayer(player: RoomPlayerResponse): RoomPlayer {
  return {
    id: player.id,
    userId: player.userId,
    username: player.username ?? player.user?.username ?? "Sconosciuto",
    seat: player.seat,
    team: player.team,
    isReady: player.isReady,
    ...(player.botModel !== undefined ? { botModel: player.botModel } : {}),
    ...(player.abandonedAt !== undefined ? { abandonedAt: player.abandonedAt } : {}),
  };
}

export function normalizeRoom(room: RoomResponse): Room {
  return {
    ...room,
    players: room.players.map(normalizeRoomPlayer),
  };
}
