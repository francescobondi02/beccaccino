import { currentTurn } from "../domain/game/turnOrder";
import { TRICK_DISPLAY_MS, roundDealTimes } from "../gameConfig";
import { isBotTier } from "../services/botUsers";
import { setBriscola } from "../game/transitions/round";
import { playCard } from "../game/transitions/cardPlay";
import type { LiveGame } from "../game/liveGame";
import { executeBotTurn } from "./botExecutor";
import { botThinkDelayMs, turnTimes } from "./timeoutPolicy";
import { clearTurnTimer, scheduleTurnTimer } from "./turnTimer";

// Arms the current turn for this version: a bot move or the human deadline.
export function armTurn(game: LiveGame): void {
  const { room } = game;
  clearTurnTimer(room.code);
  const turn = currentTurn(game);
  if (!turn) return;
  const action = {
    roomCode: room.code,
    userId: turn.player.userId,
    expectedVersion: room.version,
  };
  const now = Date.now();
  const tier = turn.player.botModel;

  if (isBotTier(tier)) {
    // Let clients show the deal or the finished trick before the bot moves.
    const shownUntil =
      game.round!.briscola === null
        ? roundDealTimes(game.round!).reviewEndsAt
        : game.trick?.cards.length === 0 && game.lastTrick
          ? game.lastTrick.completedAt!.getTime() + TRICK_DISPLAY_MS
          : now;
    scheduleTurnTimer(room.code, room.version, Math.max(0, shownUntil - now) + botThinkDelayMs(), () =>
      executeBotTurn({ ...action, tier, phase: turn.phase }),
    );
    return;
  }

  scheduleTurnTimer(room.code, room.version, turnTimes(game, turn.phase, now).deadline - now, () =>
    turn.phase === "choose_briscola"
      ? setBriscola({ ...action, source: "timeout" })
      : playCard({ ...action, source: "timeout" }),
  );
}
