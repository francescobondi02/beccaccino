import { TurnIdentity, TurnPhase } from "../game/turn";
import { logger } from "../logger";
import {
  PracticeTurnCancelledError,
  RuntimeTurnCancelledError,
} from "../game/transitions/round";
import { autoChooseBriscola, autoPlayCard } from "./autoPlay";
import { publishEvent } from "./eventPublisher";
import { changePlayerControl } from "../services/playerControl";

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
        null,
      );
    } else {
      await autoPlayCard(
        args.roomCode,
        args.userId,
        args.expectedPauseEpoch,
        args.expectedTurn,
        null,
      );
    }
    publishEvent(args.roomCode, "auto_played", {
      userId: args.userId,
      phase: args.phase,
    });

    await changePlayerControl({ roomCode: args.roomCode, userId: args.userId, action: "timeout" });
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
