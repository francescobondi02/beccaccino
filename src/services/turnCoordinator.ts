import {
  setBriscola as setBriscolaTransition,
  startFirstRound as startFirstRoundTransition,
} from "../game/transitions/round";
import { playCard as playCardTransition } from "../game/transitions/cardPlay";
import { coordinateOutcome } from "../game/coordinateOutcome";
import { publishEvents } from "../runtime/eventPublisher";
import {
  applyRuntimeDirective,
  clearRuntimeRoom,
} from "../runtime/turnRuntime";

export async function startFirstRound(gameRoomId: number, roomCode: string) {
  try {
    const outcome = await startFirstRoundTransition(gameRoomId, roomCode);
    await coordinateOutcome(outcome, {
      applyRuntime: applyRuntimeDirective,
      publishEvents,
    });
  } catch (error) {
    clearRuntimeRoom(roomCode);
    throw error;
  }
}

export async function setBriscola(
  args: Parameters<typeof setBriscolaTransition>[0],
) {
  return coordinateOutcome(await setBriscolaTransition(args), {
    applyRuntime: applyRuntimeDirective,
    publishEvents,
  });
}

export async function playCard(args: Parameters<typeof playCardTransition>[0]) {
  return coordinateOutcome(await playCardTransition(args), {
    applyRuntime: applyRuntimeDirective,
    publishEvents,
  });
}
