import type { GameState } from "./game";

// A 409 from a game move carries the current state.
export type ErrorBody = { error: string; activeRoomCode?: string; state?: GameState };
