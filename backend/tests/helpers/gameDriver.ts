import { prisma } from "../../src/db";
import { computeRoundScore, settleRound } from "../../src/domain/game/roundScore";
import { GAME_WIN_POINTS } from "../../src/gameConfig";
import { HandCard, Round } from "@prisma/client";
import { api, apiAs } from "./serverHarness";

export async function setupGame() {
  // Register users sequentially to avoid race conditions on the DB
  const usernames = ["userA", "userB", "userC", "userD"];
  const userIds: number[] = [];
  for (const name of usernames) {
    const res = await api()
      .post("/api/users/register")
      .send({ username: name, password: "test123" });
    expect(res.statusCode).toBe(201);
    userIds.push(res.body.id);
  }

  const createRoomRes = await apiAs(userIds[0], usernames[0])
    .post("/api/rooms")
    .send({});
  expect(createRoomRes.statusCode).toBe(201);

  const roomCode = createRoomRes.body.code;
  expect(typeof roomCode).toBe("string");
  expect(roomCode.length).toBeGreaterThanOrEqual(6);

  for (let i = 1; i < 4; i++) {
    const joinRes = await apiAs(userIds[i], usernames[i])
      .post(`/api/rooms/${roomCode}/join`);
    expect(joinRes.statusCode).toBe(200);
  }

  // Choose teams sequentially to avoid race conditions on team-full checks
  const teamAssignments = [
    { idx: 0, team: 0 },
    { idx: 1, team: 1 },
    { idx: 2, team: 0 },
    { idx: 3, team: 1 },
  ];
  for (const { idx, team } of teamAssignments) {
    const res = await apiAs(userIds[idx], usernames[idx])
      .post(`/api/rooms/${roomCode}/choose-team`)
      .send({ team });
    expect(res.statusCode).toBe(200);
  }

  for (let i = 0; i < 4; i++) {
    const res = await apiAs(userIds[i], usernames[i])
      .post(`/api/rooms/${roomCode}/ready`)
      .send({ isReady: true });
    expect(res.statusCode).toBe(200);
  }

  const finalRoom = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: { rounds: true },
  });

  expect(finalRoom?.started).toBe(true);
  expect(finalRoom?.rounds.length).toBe(1);

  const round = finalRoom!.rounds[0];

  const cards = await prisma.handCard.findMany({
    where: { roundId: round.id },
  });
  expect(cards.length).toBe(40);

  const cardsByPlayer: Record<number, number> = {};
  for (const card of cards) {
    cardsByPlayer[card.playerId] = (cardsByPlayer[card.playerId] || 0) + 1;
  }
  for (const count of Object.values(cardsByPlayer)) {
    expect(count).toBe(10);
  }

  return { roomCode, round, cards };
}

export async function chooseBriscola(
  roomCode: string,
  round: any,
  cards: any[]
) {
  const room = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: { players: { include: { user: true } } },
  });
  expect(room).not.toBeNull();

  const callerPlayerId = round.callerId;

  const callerCards = cards.filter((c) => c.playerId === callerPlayerId);
  const cardsBySuit: Record<string, number> = {};
  for (const card of callerCards) {
    cardsBySuit[card.suit] = (cardsBySuit[card.suit] || 0) + 1;
  }

  // Sort by count descending, break ties alphabetically for determinism
  const mostCommonSuit = Object.entries(cardsBySuit).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )[0][0];

  const callerPlayer = room!.players.find((p) => p.id === callerPlayerId)!;

  const chooseBriscolaRes = await apiAs(callerPlayer.userId, callerPlayer.user.username)
    .post(`/api/games/${roomCode}/briscola`)
    .send({ suit: mostCommonSuit });

  expect(chooseBriscolaRes.statusCode).toBe(200);
  expect(chooseBriscolaRes.body.round.briscola).toBe(mostCommonSuit);

  const handsAfterBriscola = await prisma.trick.findMany({
    where: { roundId: round.id },
  });
  expect(handsAfterBriscola.length).toBe(1);
}

export async function oneTrick(
  roomCode: string,
  round: any,
  trickNumber: number
) {
  const updatedRoom = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: { players: { include: { user: true } } },
  });
  expect(updatedRoom).not.toBeNull();

  const starterTrick = await prisma.trick.findFirst({
    where: { roundId: round.id, number: trickNumber },
  });
  expect(starterTrick).not.toBeNull();

  const playerOrder = Array.from(
    { length: 4 },
    (_, i) =>
      (updatedRoom!.players.find((p) => p.id === starterTrick!.starterId)!
        .seat! +
        i) %
      4
  ).map((seat) => updatedRoom!.players.find((p) => p.seat === seat)!);

  for (const player of playerOrder) {
    const playableRes = await apiAs(player.userId, player.user.username)
      .get(`/api/games/${roomCode}/state`);

    expect(playableRes.statusCode).toBe(200);
    const playableCards = playableRes.body.playableCards;
    expect(Array.isArray(playableCards)).toBe(true);
    expect(playableCards.length).toBeGreaterThan(0);

    const card = playableCards[0];
    expect(card).not.toBeNull();

    const playRes = await apiAs(player.userId, player.user.username)
      .post(`/api/games/${roomCode}/cards`)
      .send({ suit: card!.suit, value: card!.value });

    if (playRes.statusCode !== 200) {
      console.log("Play card error:", playRes.body, "Card:", card);
    }
    expect(playRes.statusCode).toBe(200);
  }

  const playedCards = await prisma.playedCard.findMany({
    where: { trickId: starterTrick!.id },
  });
  expect(playedCards.length).toBe(4);
}

export async function oneRound(roomCode: string, round: any) {
  for (let i = 0; i < 10; i++) {
    const tricks = await prisma.trick.findMany({
      where: { roundId: round.id },
      orderBy: { number: "asc" },
    });

    expect(tricks[i]).not.toBeNull();

    await oneTrick(roomCode, round, i + 1);

    if (i < 9) {
      const nextTrick = await prisma.trick.findFirst({
        where: { roundId: round.id, number: i + 2 },
      });
      expect(nextTrick).not.toBeNull();

      const previousTrick = await prisma.trick.findFirst({
        where: { roundId: round.id, number: i + 1 },
      });
      expect(previousTrick?.winnerId).toBe(nextTrick?.starterId);
    }
  }

  const finalTricks = await prisma.trick.findMany({
    where: { roundId: round.id },
    include: { cards: true },
  });
  expect(finalTricks.length).toBe(10);

  const allPlayedCards = await prisma.playedCard.findMany({
    where: { trickId: { in: finalTricks.map((h) => h.id) } },
  });
  expect(allPlayedCards.length).toBe(40);
}

export async function prepareNextRound(currentRound: Round): Promise<{
  nextRound: Round;
  nextCards: HandCard[];
}> {
  const nextRound = await prisma.round.findFirst({
    where: { gameRoomId: currentRound.gameRoomId },
    orderBy: { number: "desc" },
  });

  if (!nextRound) {
    throw new Error("No next round found");
  }

  const nextCards = await prisma.handCard.findMany({
    where: { roundId: nextRound.id },
  });

  return { nextRound, nextCards };
}

/**
 * Recomputes every round of a finished game from its played cards, then checks
 * the stored raw scores, that the game ended at the first round reaching the
 * target, and the stored winner (an exact tie goes to the last caller's team).
 */
export async function expectStoredResult(roomCode: string) {
  const room = await prisma.gameRoom.findUniqueOrThrow({
    where: { code: roomCode },
    include: {
      players: true,
      rounds: {
        orderBy: { number: "asc" },
        include: {
          tricks: { orderBy: { number: "asc" }, include: { cards: true } },
        },
      },
    },
  });
  const teamOf: Record<number, number> = {};
  for (const player of room.players) teamOf[player.id] = player.team!;

  let team0 = 0;
  let team1 = 0;
  for (const round of room.rounds) {
    expect(Math.max(team0, team1)).toBeLessThan(GAME_WIN_POINTS * 3);
    const settled = settleRound(
      computeRoundScore(round.tricks, teamOf, round.briscola!),
      round.cricca ? teamOf[round.callerId] : null,
    );
    expect(settled.team0Raw + settled.team1Raw).toBe(round.cricca ? 44 : 35);
    expect(round).toMatchObject(settled);
    team0 += round.team0Raw;
    team1 += round.team1Raw;
  }

  const points0 = Math.floor(team0 / 3);
  const points1 = Math.floor(team1 / 3);
  expect(room.finished).toBe(true);
  expect(Math.max(points0, points1)).toBeGreaterThanOrEqual(GAME_WIN_POINTS);
  expect(room.winnerTeam).toBe(
    points0 === points1
      ? teamOf[room.rounds[room.rounds.length - 1].callerId]
      : points0 > points1 ? 0 : 1,
  );
}
