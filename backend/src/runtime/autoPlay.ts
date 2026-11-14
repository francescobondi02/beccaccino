import { prisma } from "../db";
import { Suit, SUITS } from "../domain/game/cards";
import {
  setBriscola,
} from "../game/transitions/round";
import { playCard } from "../game/transitions/cardPlay";
import { readPlayableCards } from "../services/playableCards";
import { TurnIdentity } from "../game/turn";

export async function autoPlayCard(
  roomCode: string,
  userId: number,
  expectedPauseEpoch?: number,
  expectedTurn?: TurnIdentity,
  expectedBotModel?: string | null,
): Promise<void> {
  const cards = await readPlayableCards({ roomCode, userId });
  if (cards.length === 0) {
    throw new Error("No playable card found for the current runtime turn");
  }
  const card = cards[0];
  await playCard({
    roomCode,
    userId,
    suit: card.suit,
    value: card.value,
    autoPlayed: true,
    expectedPauseEpoch,
    expectedTurn,
    expectedBotModel,
  });
}

export async function autoChooseBriscola(
  roomCode: string,
  userId: number,
  expectedPauseEpoch?: number,
  expectedTurn?: TurnIdentity,
  expectedBotModel?: string | null,
): Promise<void> {
  const room = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: {
      players: true,
      rounds: { orderBy: { number: "desc" }, take: 1 },
    },
  });
  if (!room || room.rounds.length === 0) {
    throw new Error("No active round found for the current runtime turn");
  }
  const player = room.players.find((candidate) => candidate.userId === userId);
  if (!player || room.rounds[0].briscola !== null) {
    throw new Error("No briscola choice found for the current runtime turn");
  }

  const cards = await prisma.handCard.findMany({
    where: { playerId: player.id, roundId: room.rounds[0].id },
  });
  const counts = new Map<Suit, number>();
  for (const card of cards) {
    counts.set(card.suit, (counts.get(card.suit) ?? 0) + 1);
  }
  const suit = SUITS.reduce((best, candidate) => {
    const difference =
      (counts.get(candidate) ?? 0) - (counts.get(best) ?? 0);
    return difference > 0 || (difference === 0 && candidate < best)
      ? candidate
      : best;
  });

  await setBriscola({
    roomCode,
    userId,
    suit,
    autoChosen: true,
    expectedPauseEpoch,
    expectedTurn,
    expectedBotModel,
  });
}
