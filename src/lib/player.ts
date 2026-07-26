// Normalized player shape that pages consume, mapped from the API's raw room
// player objects (which nest username under `user`).

export interface ApiPlayer {
  id: number;
  userId: number;
  username: string;
  seat: number | null;
  team: number | null;
  isReady: boolean;
}

export function normalizePlayer(p: any): ApiPlayer {
  return {
    id: p.id,
    userId: p.userId,
    username: p.user?.username ?? "Sconosciuto",
    seat: p.seat,
    team: p.team,
    isReady: p.isReady,
  };
}
