import { prisma } from "../db";
import { TurnIdentity, TurnPhase } from "../game/turn";
import { logger } from "../logger";
import { BotServiceError, requestBotMove } from "../services/botClient";
import { BotTier } from "../services/botUsers";
import { buildBotTurn } from "../services/botState";
import { readPlayableCards } from "../services/playableCards";
import {
  PracticeTurnCancelledError,
  RuntimeTurnCancelledError,
  setBriscola,
} from "../game/transitions/round";
import { playCard } from "../game/transitions/cardPlay";
import { autoChooseBriscola, autoPlayCard } from "./autoPlay";
import { hasBotSeat } from "./botRegistry";

async function isPauseEpochCurrent(
  roomCode: string,
  expectedPauseEpoch: number,
): Promise<boolean> {
  try {
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      select: { pausedAt: true, pauseEpoch: true },
    });
    return Boolean(
      room && !room.pausedAt && room.pauseEpoch === expectedPauseEpoch,
    );
  } catch (error) {
    logger.warn(
      { err: error, roomCode, expectedPauseEpoch },
      "bot_pause_fence_read_failed",
    );
    return false;
  }
}

export async function executeBotTurn(args: {
  roomCode: string;
  userId: number;
  tier: BotTier;
  phase: TurnPhase;
  expectedPauseEpoch: number;
  expectedTurn: TurnIdentity;
}): Promise<void> {
  if (!hasBotSeat(args.roomCode, args.userId)) return;

  try {
    if (!(await isPauseEpochCurrent(args.roomCode, args.expectedPauseEpoch))) {
      return;
    }
    const { state, seat, turnSeat, playerId, gameRoomId } = await buildBotTurn(
      args.roomCode,
      args.userId,
    );
    if (turnSeat !== seat) {
      throw new BotServiceError(
        `bot seat ${seat} does not own turn ${String(turnSeat)}`,
      );
    }
    const expectedLegalCards =
      args.phase === "play_card"
        ? (await readPlayableCards(args)).map((card) => ({
            suit: card.suit,
            value: card.value,
          }))
        : undefined;
    const move = await requestBotMove({
      state,
      seat,
      tier: args.tier,
      expectedLegalCards,
    });
    const expectedKind = args.phase === "choose_briscola" ? "briscola" : "card";
    if (move.kind !== expectedKind) {
      throw new BotServiceError(
        `bot returned a ${move.kind} move during ${args.phase}`,
      );
    }

    if (move.kind === "briscola") {
      await setBriscola({
        gameRoomId,
        playerId,
        suit: move.suit,
        expectedPauseEpoch: args.expectedPauseEpoch,
        expectedTurn: args.expectedTurn,
        expectedBotModel: args.tier,
      });
    } else {
      await playCard({
        roomCode: args.roomCode,
        userId: args.userId,
        suit: move.suit,
        value: move.value,
        signal: move.signal,
        expectedPauseEpoch: args.expectedPauseEpoch,
        expectedTurn: args.expectedTurn,
        expectedBotModel: args.tier,
      });
    }
  } catch (error) {
    if (
      error instanceof PracticeTurnCancelledError ||
      error instanceof RuntimeTurnCancelledError
    ) {
      logger.debug(args, "bot_move_cancelled_by_pause");
      return;
    }
    if (!hasBotSeat(args.roomCode, args.userId)) {
      logger.debug(args, "bot_move_abandoned_room_gone");
      return;
    }
    if (!(await isPauseEpochCurrent(args.roomCode, args.expectedPauseEpoch))) {
      logger.debug(args, "bot_move_cancelled_by_pause");
      return;
    }

    logger.error({ err: error, ...args }, "bot_fallback_to_autoplay");
    try {
      if (args.phase === "choose_briscola") {
        await autoChooseBriscola(
          args.roomCode,
          args.userId,
          args.expectedPauseEpoch,
          args.expectedTurn,
          args.tier,
        );
      } else {
        await autoPlayCard(
          args.roomCode,
          args.userId,
          args.expectedPauseEpoch,
          args.expectedTurn,
          args.tier,
        );
      }
    } catch (fallbackError) {
      if (
        fallbackError instanceof PracticeTurnCancelledError ||
        fallbackError instanceof RuntimeTurnCancelledError
      ) {
        logger.debug(args, "bot_fallback_cancelled_by_pause");
        return;
      }
      logger.warn(
        { err: fallbackError, ...args },
        "bot_autoplay_fallback_failed",
      );
      throw fallbackError;
    }
  }
}
