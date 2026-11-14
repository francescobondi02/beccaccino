import { prisma } from "../db";
import type { TurnPhase } from "../contract/game";
import { logger } from "../logger";
import { BotServiceError, requestBotMove } from "../services/botClient";
import { BotTier } from "../services/botUsers";
import { buildBotTurn } from "../services/botState";
import { selectLegalCards } from "../domain/game/legalCards";
import { loadLiveGame } from "../game/liveGame";
import { RuntimeTurnCancelledError, setBriscola } from "../game/transitions/round";
import { playCard } from "../game/transitions/cardPlay";

// Asks the bot service for a move. If it fails, the server picks the move.
export async function executeBotTurn(args: {
  roomCode: string;
  userId: number;
  tier: BotTier;
  phase: TurnPhase;
  expectedVersion: number;
}): Promise<void> {
  const action = { roomCode: args.roomCode, userId: args.userId, expectedVersion: args.expectedVersion };
  try {
    const game = await loadLiveGame(prisma, args.roomCode);
    if (game.room.version !== args.expectedVersion) return;
    const { state, seat } = buildBotTurn(game, args.userId);
    const player = game.players.find((candidate) => candidate.userId === args.userId)!;
    const move = await requestBotMove({
      state,
      seat,
      tier: args.tier,
      expectedLegalCards:
        args.phase === "play_card"
          ? selectLegalCards(game.hands.get(player.id) ?? [], game.trick?.cards[0]?.suit ?? null)
          : undefined,
    });
    if (move.kind === "briscola" && args.phase === "choose_briscola") {
      await setBriscola({ ...action, source: "bot", suit: move.suit });
    } else if (move.kind === "card" && args.phase === "play_card") {
      await playCard({
        ...action,
        source: "bot",
        card: { suit: move.suit, value: move.value },
        signal: move.signal,
      });
    } else {
      throw new BotServiceError(`bot returned a ${move.kind} move during ${args.phase}`);
    }
  } catch (error) {
    if (error instanceof RuntimeTurnCancelledError) return;
    logger.error({ err: error, ...args }, "bot_fallback_to_autoplay");
    try {
      if (args.phase === "choose_briscola") await setBriscola({ ...action, source: "bot_fallback" });
      else await playCard({ ...action, source: "bot_fallback" });
    } catch (fallbackError) {
      if (fallbackError instanceof RuntimeTurnCancelledError) return;
      throw fallbackError;
    }
  }
}
