import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../logger";
import { GameError } from "../utils/gameError";
import { withRoomLock } from "../utils/roomLock";
import { publishEvent } from "../runtime/eventPublisher";
import { armTurn } from "../runtime/turnRuntime";
import { loadLiveGame, type LiveGame } from "./liveGame";
import { toGameState } from "./gameState";
import type { GameState, LastAction } from "../contract/game";

// Checks its own rules and writes its rows; null means nothing to do.
type GameChange = (
  game: LiveGame,
  tx: Prisma.TransactionClient,
) => Promise<LastAction | null>;

// These move the turn to another player or phase.
const TURN_STARTS = new Set<LastAction["kind"]>([
  "game_started",
  "briscola_chosen",
  "card_played",
  "resumed",
]);

class VersionConflict extends Error {}

// The one write path for a game. Returns the state `viewerId` sees, if given.
export function runGameAction(roomCode: string, change: GameChange, viewerId?: number) {
  return withRoomLock(roomCode, () => runGameActionUnlocked(roomCode, change, viewerId));
}

// For code that already holds the room lock.
export async function runGameActionUnlocked(
  roomCode: string,
  change: GameChange,
  viewerId?: number,
): Promise<GameState | null> {
  let lastAction: LastAction | null;
  try {
    lastAction = await prisma.$transaction(async (tx) => {
      const game = await loadLiveGame(tx, roomCode);
      const action = await change(game, tx);
      if (!action) return null;
      const now = new Date();
      const { count } = await tx.gameRoom.updateMany({
        where: { id: game.room.id, version: game.room.version },
        data: {
          version: { increment: 1 },
          lastActivityAt: now,
          ...(TURN_STARTS.has(action.kind) ? { turnStartedAt: now } : {}),
        },
      });
      if (count === 0) throw new VersionConflict();
      return action;
    });
  } catch (error) {
    if (!(error instanceof VersionConflict)) throw error;
    // Another writer won. Deferred actions drop; a person gets the current state.
    if (viewerId === undefined) return null;
    const game = await loadLiveGame(prisma, roomCode);
    throw new GameError("La partita è cambiata. Riprova.", 409, {
      state: toGameState(game, viewerId, Date.now(), null),
    });
  }
  if (!lastAction) return null;

  // Committed. From here never throw: the reconciler repairs the runtime.
  try {
    const game = await loadLiveGame(prisma, roomCode);
    armTurn(game);
    const now = Date.now();
    let viewerState: GameState | null = null;
    for (const player of game.players) {
      if (player.isBot || player.abandonedAt) continue;
      const state = toGameState(game, player.userId, now, lastAction);
      if (player.userId === viewerId) viewerState = state;
      publishEvent(`user:${player.userId}`, "game_state", state, { roomCode });
    }
    return viewerState;
  } catch (error) {
    logger.error({ err: error, roomCode }, "game_publish_failed");
    return null;
  }
}
