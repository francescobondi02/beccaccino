import request from "supertest";
import http from "http";
import { prisma } from "../../src/db";
import app from "../../src/app";
import { computePoints } from "../../src/domain/game/computePoints";
import { Suit } from "@prisma/client";
import { PlayerCard, Round } from "@prisma/client";

// Shared HTTP server — avoids "Parse Error: Expected HTTP/" that occurs when
// supertest repeatedly creates and tears down servers under Express 5.
// The server is started once and reused for all requests within the test run.
let server: http.Server | null = null;
let baseUrl: string = "";

export function getServer(): http.Server {
  if (!server) {
    server = app.listen(0); // random available port
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  }
  return server;
}

export function getBaseUrl(): string {
  getServer(); // ensure started
  return baseUrl;
}

export function closeServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
      server = null;
      baseUrl = "";
    } else {
      resolve();
    }
  });
}

// Convenience wrapper — sends requests to the shared server
export function api() {
  return request(getServer());
}

/**
 * Auth-aware request helper.
 *
 * The auth middleware (in test mode with ALLOW_TEST_AUTH_BYPASS=true) reads
 * `x-test-user-id` and `x-test-username` headers and populates `req.user`.
 * This wraps supertest so every request from the helper is authenticated as
 * a specific user without needing to manage cookies.
 *
 * Usage:
 *   apiAs(userId, username).post("/api/rooms").send({});
 */
export function apiAs(userId: number, username: string) {
  const agent = request(getServer());
  return {
    get: (url: string) =>
      agent
        .get(url)
        .set("x-test-user-id", String(userId))
        .set("x-test-username", username),
    post: (url: string) =>
      agent
        .post(url)
        .set("x-test-user-id", String(userId))
        .set("x-test-username", username),
    put: (url: string) =>
      agent
        .put(url)
        .set("x-test-user-id", String(userId))
        .set("x-test-username", username),
    delete: (url: string) =>
      agent
        .delete(url)
        .set("x-test-user-id", String(userId))
        .set("x-test-username", username),
    patch: (url: string) =>
      agent
        .patch(url)
        .set("x-test-user-id", String(userId))
        .set("x-test-username", username),
  };
}

export async function clearDatabase() {
  await prisma.$transaction([
    prisma.expertAnnotation.deleteMany(),
    prisma.annotationScenario.deleteMany(),
    prisma.practiceMatch.deleteMany(),
    prisma.playedCard.deleteMany(),
    prisma.playerCard.deleteMany(),
    prisma.hand.deleteMany(),
    prisma.round.deleteMany(),
    prisma.player.deleteMany(),
    prisma.gameRoom.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

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
      .post("/api/rooms/join")
      .send({ roomCode });
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

  const cards = await prisma.playerCard.findMany({
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

  let callerPlayerId: number | null = null;

  if (round.number == 1) {
    for (const card of cards) {
      if (card.value === "quattro" && card.suit === "denara") {
        callerPlayerId = card.playerId;
        break;
      }
    }
  } else {
    const previousRound = await prisma.round.findFirst({
      where: { gameRoomId: room!.id, number: round.number - 1 },
      include: {
        hands: {
          orderBy: { number: "asc" },
          take: 1,
        },
      },
    });

    expect(previousRound).not.toBeNull();
    const firstHand = previousRound!.hands[0];
    expect(firstHand).not.toBeNull();

    const prevCaller = room!.players.find((p) => p.id === firstHand!.starterId);
    const nextSeat = (prevCaller!.seat! + 1) % 4;
    const nextPlayer = room!.players.find((p) => p.seat === nextSeat);
    callerPlayerId = nextPlayer!.id;
    expect(nextPlayer).not.toBeNull();
  }

  expect(callerPlayerId).not.toBeNull();

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

  const chooseBriscolaRes = await api()
    .post("/api/games/choose-briscola")
    .set("x-test-user-id", String(callerPlayer.userId))
    .set("x-test-username", callerPlayer.user.username)
    .send({
      gameRoomId: room!.id,
      suit: mostCommonSuit,
    });

  expect(chooseBriscolaRes.statusCode).toBe(200);
  expect(chooseBriscolaRes.body.round.briscola).toBe(mostCommonSuit);

  const handsAfterBriscola = await prisma.hand.findMany({
    where: { roundId: round.id },
  });
  expect(handsAfterBriscola.length).toBe(1);
}

export async function oneHand(
  roomCode: string,
  round: any,
  handNumber: number
) {
  const updatedRoom = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: { players: { include: { user: true } } },
  });
  expect(updatedRoom).not.toBeNull();

  const starterHand = await prisma.hand.findFirst({
    where: { roundId: round.id, number: handNumber },
  });
  expect(starterHand).not.toBeNull();

  const playerOrder = Array.from(
    { length: 4 },
    (_, i) =>
      (updatedRoom!.players.find((p) => p.id === starterHand!.starterId)!
        .seat! +
        i) %
      4
  ).map((seat) => updatedRoom!.players.find((p) => p.seat === seat)!);

  for (const player of playerOrder) {
    const playableRes = await apiAs(player.userId, player.user.username)
      .get(`/api/games/playable-cards/${roomCode}`);

    expect(playableRes.statusCode).toBe(200);
    const playableCards = playableRes.body.playableCards;
    expect(Array.isArray(playableCards)).toBe(true);
    expect(playableCards.length).toBeGreaterThan(0);

    const card = playableCards[0];
    expect(card).not.toBeNull();

    const playRes = await apiAs(player.userId, player.user.username)
      .post("/api/games/play-card")
      .send({
        roomCode,
        suit: card!.suit,
        value: card!.value,
      });

    if (playRes.statusCode !== 200) {
      console.log("Play card error:", playRes.body, "Card:", card);
    }
    expect(playRes.statusCode).toBe(200);
  }

  const playedCards = await prisma.playedCard.findMany({
    where: { handId: starterHand!.id },
  });
  expect(playedCards.length).toBe(4);
}

export async function oneRound(roomCode: string, round: any) {
  for (let i = 0; i < 10; i++) {
    const hands = await prisma.hand.findMany({
      where: { roundId: round.id },
      orderBy: { number: "asc" },
    });

    expect(hands[i]).not.toBeNull();

    await oneHand(roomCode, round, i + 1);

    if (i < 9) {
      const nextHand = await prisma.hand.findFirst({
        where: { roundId: round.id, number: i + 2 },
      });
      expect(nextHand).not.toBeNull();

      const previousHand = await prisma.hand.findFirst({
        where: { roundId: round.id, number: i + 1 },
      });
      expect(previousHand?.winnerId).toBe(nextHand?.starterId);
    }
  }

  const finalHands = await prisma.hand.findMany({
    where: { roundId: round.id },
    include: { cards: true },
  });
  expect(finalHands.length).toBe(10);

  const allPlayedCards = await prisma.playedCard.findMany({
    where: { handId: { in: finalHands.map((h) => h.id) } },
  });
  expect(allPlayedCards.length).toBe(40);

  const players = await prisma.player.findMany({
    where: { gameRoomId: round.gameRoomId },
  });

  const teamPlayers: Record<number, number> = {};
  for (const player of players) {
    teamPlayers[player.id] = player.team!;
  }

  const rawPoints = computePoints(finalHands, teamPlayers, round.briscola);
  const lastHand = finalHands.reduce((prev, curr) =>
    curr.number > prev.number ? curr : prev
  );
  const bonusTeam = teamPlayers[lastHand.winnerId!];

  return {
    rawPoints,
    finalPoints: {
      team0: rawPoints.team0.points,
      team1: rawPoints.team1.points,
    },
    bonusTeam,
  };
}

export async function computeRoundPoints(
  roundId: number,
  roundCount: number,
  team0Total: number,
  team1Total: number
): Promise<{
  team0Cleaned: number;
  team1Cleaned: number;
  team0Total: number;
  team1Total: number;
}> {
  const round = await prisma.round.findUnique({ where: { id: roundId } });

  const hands = await prisma.hand.findMany({
    where: { roundId },
    include: { cards: true },
  });

  const players = await prisma.player.findMany({
    where: { gameRoomId: round!.gameRoomId },
  });

  const teamPlayers: Record<number, number> = {};
  for (const p of players) {
    teamPlayers[p.id] = p.team!;
  }

  const rawPoints = computePoints(hands, teamPlayers, round!.briscola as Suit);

  const team0Cleaned = rawPoints.team0.points;
  const team1Cleaned = rawPoints.team1.points;

  const roundSum = team0Cleaned + team1Cleaned;
  if (roundSum !== 11) {
    throw new Error(`Round ${roundCount} does not sum to 11 (got ${roundSum})`);
  }

  console.log(
    `Round ${roundCount}: Team 0 → ${team0Cleaned} / Team 1 → ${team1Cleaned}` +
      ` (Total: ${team0Total + team0Cleaned} - ${team1Total + team1Cleaned})`
  );

  return {
    team0Cleaned,
    team1Cleaned,
    team0Total: team0Total + team0Cleaned,
    team1Total: team1Total + team1Cleaned,
  };
}

export async function prepareNextRound(currentRound: Round): Promise<{
  nextRound: Round;
  nextCards: PlayerCard[];
}> {
  const nextRound = await prisma.round.findFirst({
    where: { gameRoomId: currentRound.gameRoomId },
    orderBy: { number: "desc" },
  });

  if (!nextRound) {
    throw new Error("No next round found");
  }

  const nextCards = await prisma.playerCard.findMany({
    where: { roundId: nextRound.id },
  });

  return { nextRound, nextCards };
}
