import { prisma } from "../db";
import { TurnIdentity, TurnPhase } from "../game/transitions/types";
import { logger } from "../logger";
import {
  PracticeTurnCancelledError,
  RuntimeTurnCancelledError,
} from "../game/transitions/round";
import { autoChooseBriscola, autoPlayCard } from "./autoPlay";
import { publishEvent } from "./eventPublisher";
import { recordTimeout } from "./timeoutPolicy";

export async function executeTimedOutTurn(args: {
  roomCode: string;
  userId: number;
  phase: TurnPhase;
  expectedPauseEpoch: number;
  expectedTurn: TurnIdentity;
}): Promise<void> {
  try {
    if (args.phase === "choose_briscola") {
      await autoChooseBriscola(
        args.roomCode,
        args.userId,
        args.expectedPauseEpoch,
        args.expectedTurn,
      );
    } else {
      await autoPlayCard(
        args.roomCode,
        args.userId,
        args.expectedPauseEpoch,
        args.expectedTurn,
      );
    }
    publishEvent(args.roomCode, "auto_played", {
      userId: args.userId,
      phase: args.phase,
    });

    const { newlyKicked } = recordTimeout(args.roomCode, args.userId);
    if (newlyKicked) {
      const player = await prisma.player.findFirst({
        where: {
          userId: args.userId,
          gameRoom: { code: args.roomCode },
        },
        include: { user: true },
      });
      publishEvent(args.roomCode, "player_kicked_timeout", {
        userId: args.userId,
        username: player?.user.username ?? "Giocatore",
      });
    }
  } catch (error) {
    if (
      error instanceof PracticeTurnCancelledError ||
      error instanceof RuntimeTurnCancelledError
    ) {
      logger.debug(args, "auto_play_cancelled_by_pause");
      return;
    }
    logger.warn({ err: error, ...args }, "auto_play_failed");
    throw error;
  }
}
