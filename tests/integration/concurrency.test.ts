import { prisma } from "../../src/db";
import {
  clearDatabase,
  setupGame,
  chooseBriscola,
  api,
} from "../helpers/gameHelpers";

beforeEach(async () => {
  await clearDatabase();
});

describe("Concurrent play-card requests", () => {
  it("only one player succeeds when two play simultaneously but only one has the turn", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);

    // Get game state to determine whose turn it is
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    const currentHand = await prisma.hand.findFirst({
      where: { roundId: round.id },
      orderBy: { number: "desc" },
    });

    // Determine the starter (has the turn) and another player (does not)
    const starter = room!.players.find(
      (p) => p.id === currentHand!.starterId,
    );
    const otherPlayer = room!.players.find(
      (p) => p.id !== currentHand!.starterId,
    );

    // Get a card for each player
    const starterCard = await prisma.playerCard.findFirst({
      where: { playerId: starter!.id, roundId: round.id },
    });
    const otherCard = await prisma.playerCard.findFirst({
      where: { playerId: otherPlayer!.id, roundId: round.id },
    });

    // Fire both requests simultaneously
    const [res1, res2] = await Promise.all([
      api().post("/api/games/play-card").send({
        roomCode,
        userId: starter!.userId,
        suit: starterCard!.suit,
        value: starterCard!.value,
      }),
      api().post("/api/games/play-card").send({
        roomCode,
        userId: otherPlayer!.userId,
        suit: otherCard!.suit,
        value: otherCard!.value,
      }),
    ]);

    // One should succeed, the other should fail with turn error
    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([200, 500]);

    // The failure should be a turn-related error
    const failedRes = res1.statusCode === 500 ? res1 : res2;
    expect(failedRes.body.error).toMatch(/turn/i);
  });

  it("rejects double-submission of the same card by the same player", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);

    // Determine whose turn it is
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    const currentHand = await prisma.hand.findFirst({
      where: { roundId: round.id },
      orderBy: { number: "desc" },
    });

    const starter = room!.players.find(
      (p) => p.id === currentHand!.starterId,
    );

    const starterCard = await prisma.playerCard.findFirst({
      where: { playerId: starter!.id, roundId: round.id },
    });

    // Fire two identical requests simultaneously
    const [res1, res2] = await Promise.all([
      api().post("/api/games/play-card").send({
        roomCode,
        userId: starter!.userId,
        suit: starterCard!.suit,
        value: starterCard!.value,
      }),
      api().post("/api/games/play-card").send({
        roomCode,
        userId: starter!.userId,
        suit: starterCard!.suit,
        value: starterCard!.value,
      }),
    ]);

    // One should succeed, the other should fail
    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([200, 500]);

    // The failure should be about not having the card or not the player's turn
    const failedRes = res1.statusCode === 500 ? res1 : res2;
    expect(failedRes.body.error).toMatch(/does not have|turn/i);
  });

  it("maintains game state consistency after concurrent attempts", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);

    // Determine whose turn it is
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    const currentHand = await prisma.hand.findFirst({
      where: { roundId: round.id },
      orderBy: { number: "desc" },
    });

    const starter = room!.players.find(
      (p) => p.id === currentHand!.starterId,
    );
    const otherPlayer = room!.players.find(
      (p) => p.id !== currentHand!.starterId,
    );

    // Get cards for both players
    const starterCard = await prisma.playerCard.findFirst({
      where: { playerId: starter!.id, roundId: round.id },
    });
    const otherCard = await prisma.playerCard.findFirst({
      where: { playerId: otherPlayer!.id, roundId: round.id },
    });

    // Fire both simultaneously
    await Promise.all([
      api().post("/api/games/play-card").send({
        roomCode,
        userId: starter!.userId,
        suit: starterCard!.suit,
        value: starterCard!.value,
      }),
      api().post("/api/games/play-card").send({
        roomCode,
        userId: otherPlayer!.userId,
        suit: otherCard!.suit,
        value: otherCard!.value,
      }),
    ]);

    // Verify: exactly one card should be in played_cards for this hand
    const playedCards = await prisma.playedCard.findMany({
      where: { handId: currentHand!.id },
    });
    expect(playedCards.length).toBe(1);

    // Verify: the starter should have exactly 9 cards remaining
    const starterRemainingCards = await prisma.playerCard.findMany({
      where: { playerId: starter!.id, roundId: round.id },
    });
    expect(starterRemainingCards.length).toBe(9);

    // Verify: the other player should still have all 10 cards (their play was rejected)
    const otherRemainingCards = await prisma.playerCard.findMany({
      where: { playerId: otherPlayer!.id, roundId: round.id },
    });
    expect(otherRemainingCards.length).toBe(10);
  });
});
