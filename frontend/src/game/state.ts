import { replaceEqualDeep } from "@tanstack/react-query";
import type { GameState } from "@contract/game";

// Client update rule: drop an older state, replace an equal or newer one.
// replaceEqualDeep keeps unchanged parts by reference, so the table does not
// restart animations when the same state arrives twice.
export function keepNewer(old: GameState | undefined, next: GameState): GameState {
  return old && next.version < old.version ? old : replaceEqualDeep(old, next);
}
