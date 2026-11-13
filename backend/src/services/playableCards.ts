import { prisma } from "../db";
import { selectLegalCards } from "../domain/game/legalCards";
import { GameError } from "../utils/gameError";

export async function readPlayableCards({
  roomCode,
  userId,
}: {
  roomCode: string;
  userId: number;
}) {
  const room = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: {
      players: true,
      rounds: {
        orderBy: { number: "desc" },
        take: 1,
        include: {
          hands: {
            orderBy: { number: "desc" },
            take: 1,
            include: { cards: true },
          },
        },
      },
    },
  });

  if (!room || room.started === false) {
    throw new GameError("Game room not found or not started", 404);
  }

  const player = room.players.find((p) => p.userId === userId);
  if (!player) {
    throw new GameError("Player not in this game room", 403);
  }

  // Before briscola is chosen there is no Hand yet — nothing is playable,
  // which is an ordinary state, not an error.
  const currentRound = room.rounds[0];
  const currentHand = currentRound?.hands[0];
  if (!currentRound || !currentHand) {
    return [];
  }

  const cardsInHand = await prisma.playerCard.findMany({
    where: {
      playerId: player.id,
      roundId: currentRound.id,
    },
  });
  const leadSuit =
    currentHand.cards.find((card) => card.position === 0)?.suit ?? null;
  return selectLegalCards(cardsInHand, leadSuit);
}
