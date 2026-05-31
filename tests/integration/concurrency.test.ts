import { prisma } from "../../src/db";
import {
  clearDatabase,
  setupGame,
  chooseBriscola,
  apiAs,
} from "../helpers/gameHelpers";

beforeEach(async () => {
  await clearDatabase();
});

describe("Concurrent play-card requests", () => {
  it("only one player succeeds when two play simultaneously but only one has the turn", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);

    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: { include: { user: true } } },
    });

    const currentHand = await prisma.hand.findFirst({
      where: { roundId: round.id },
      orderBy: { number: "desc" },
    });

    const starter = room!.players.find((p) => p.id === currentHand!.starterId)!;
    const otherPlayer = room!.players.find((p) => p.id !== currentHand!.starterId)!;

    const starterCard = await prisma.playerCard.findFirst({
      where: { playerId: starter.id, roundId: round.id },
    });
    const otherCard = await prisma.playerCard.findFirst({
      where: { playerId: otherPlayer.id, roundId: round.id },
    });

    const [res1, res2] = await Promise.all([
      apiAs(starter.userId, starter.user.username)
        .post("/api/games/play-card")
        .send({
          roomCode,
          suit: starterCard!.suit,
          value: starterCard!.value,
        }),
      apiAs(otherPlayer.userId, otherPlayer.user.username)
        .post("/api/games/play-card")
        .send({
          roomCode,
          suit: otherCard!.suit,
          value: otherCard!.value,
        }),
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([200, 403]);

    const failedRes = res1.statusCode !== 200 ? res1 : res2;
    expect(failedRes.body.error).toMatch(/turn/i);
  });

  it("rejects double-submission of the same card by the same player", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);

    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: { include: { user: true } } },
    });

    const currentHand = await prisma.hand.findFirst({
      where: { roundId: round.id },
      orderBy: { number: "desc" },
    });

    const starter = room!.players.find((p) => p.id === currentHand!.starterId)!;

    const starterCard = await prisma.playerCard.findFirst({
      where: { playerId: starter.id, roundId: round.id },
    });

    const [res1, res2] = await Promise.all([
      apiAs(starter.userId, starter.user.username)
        .post("/api/games/play-card")
        .send({
          roomCode,
          suit: starterCard!.suit,
          value: starterCard!.value,
        }),
      apiAs(starter.userId, starter.user.username)
        .post("/api/games/play-card")
        .send({
          roomCode,
          suit: starterCard!.suit,
          value: starterCard!.value,
        }),
    ]);

    // Either: 200 + 400 ("does not have this card" — winner already deleted it)
    // or:     200 + 403 ("not your turn"  — winner already advanced the turn)
    // Both are acceptable: the second request is rejected, no double-play.
    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses[0]).toBe(200);
    expect([400, 403]).toContain(statuses[1]);

    const failedRes = res1.statusCode !== 200 ? res1 : res2;
    expect(failedRes.body.error).toMatch(/does not have|turn/i);
  });

  it("maintains game state consistency after concurrent attempts", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);

    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: { include: { user: true } } },
    });

    const currentHand = await prisma.hand.findFirst({
      where: { roundId: round.id },
      orderBy: { number: "desc" },
    });

    const starter = room!.players.find((p) => p.id === currentHand!.starterId)!;
    const otherPlayer = room!.players.find((p) => p.id !== currentHand!.starterId)!;

    const starterCard = await prisma.playerCard.findFirst({
      where: { playerId: starter.id, roundId: round.id },
    });
    const otherCard = await prisma.playerCard.findFirst({
      where: { playerId: otherPlayer.id, roundId: round.id },
    });

    await Promise.all([
      apiAs(starter.userId, starter.user.username)
        .post("/api/games/play-card")
        .send({
          roomCode,
          suit: starterCard!.suit,
          value: starterCard!.value,
        }),
      apiAs(otherPlayer.userId, otherPlayer.user.username)
        .post("/api/games/play-card")
        .send({
          roomCode,
          suit: otherCard!.suit,
          value: otherCard!.value,
        }),
    ]);

    const playedCards = await prisma.playedCard.findMany({
      where: { handId: currentHand!.id },
    });
    expect(playedCards.length).toBe(1);

    const starterRemainingCards = await prisma.playerCard.findMany({
      where: { playerId: starter.id, roundId: round.id },
    });
    expect(starterRemainingCards.length).toBe(9);

    const otherRemainingCards = await prisma.playerCard.findMany({
      where: { playerId: otherPlayer.id, roundId: round.id },
    });
    expect(otherRemainingCards.length).toBe(10);
  });
});
