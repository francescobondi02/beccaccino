import { prisma } from "../../src/db";
import { playCard } from "../../src/game/transitions/cardPlay";
import { RuntimeTurnCancelledError } from "../../src/game/transitions/round";
import { readPlayableCards } from "../../src/services/playableCards";
import { clearDatabase } from "../helpers/database";
import { chooseBriscola, setupGame } from "../helpers/gameDriver";

describe("runtime turn identity", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it("rejects stale work when the same user owns a different persisted turn", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    const room = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
      include: { players: true },
    });
    const previousHand = await prisma.hand.findFirstOrThrow({
      where: { roundId: round.id },
      include: { cards: true },
    });
    const player = room.players.find(
      (candidate) => candidate.id === previousHand.starterId,
    )!;
    await prisma.hand.update({
      where: { id: previousHand.id },
      data: { winnerId: player.id },
    });
    const currentHand = await prisma.hand.create({
      data: {
        roundId: round.id,
        number: 2,
        starterId: player.id,
      },
    });
    const [card] = await readPlayableCards({
      roomCode,
      userId: player.userId,
    });
    const cardsBefore = await prisma.playedCard.count({
      where: { handId: currentHand.id },
    });

    await expect(
      playCard({
        roomCode,
        userId: player.userId,
        suit: card.suit,
        value: card.value,
        autoPlayed: true,
        expectedTurn: {
          roundId: round.id,
          handId: previousHand.id,
          playedCardCount: previousHand.cards.length,
        },
      }),
    ).rejects.toBeInstanceOf(RuntimeTurnCancelledError);
    expect(
      await prisma.playedCard.count({ where: { handId: currentHand.id } }),
    ).toBe(cardsBefore);
  });
});
