import {
  playCard as playCardTransition,
  setBriscola as setBriscolaTransition,
  startFirstRound as startFirstRoundTransition,
} from "./gameService";
import {
  applyTurnDirective,
  clearRoomTimerData,
} from "./turnTimer";

export async function startFirstRound(gameRoomId: number, roomCode: string) {
  try {
    const directive = await startFirstRoundTransition(gameRoomId, roomCode);
    applyTurnDirective(directive);
  } catch (error) {
    clearRoomTimerData(roomCode);
    throw error;
  }
}

export async function setBriscola(
  args: Parameters<typeof setBriscolaTransition>[0],
) {
  const { turnDirective, ...result } = await setBriscolaTransition(args);
  applyTurnDirective(turnDirective);
  return result;
}

export async function playCard(args: Parameters<typeof playCardTransition>[0]) {
  const directive = await playCardTransition(args);
  applyTurnDirective(directive);
}
