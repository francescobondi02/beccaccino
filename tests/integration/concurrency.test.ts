import { prisma } from "../../src/db";
import {
  clearDatabase,
  setupGame,
  chooseBriscola,
  api,
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
    // Use the starter's partner (2 seats away): never next in turn order, so
    // their play stays illegal even if the lock runs the starter's play first.
    const otherPlayer = room!.players.find(
      (p) => p.seat === (starter.seat! + 2) % 4,
    )!;

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
    // Use the starter's partner (2 seats away): never next in turn order, so
    // their play stays illegal even if the lock runs the starter's play first.
    const otherPlayer = room!.players.find(
      (p) => p.seat === (starter.seat! + 2) % 4,
    )!;

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

describe("Concurrent join-room requests", () => {
  it("only one of two simultaneous joins into a room with 3 players succeeds", async () => {
    const usernames = ["userA", "userB", "userC", "userD", "userE"];
    const userIds: number[] = [];
    for (const name of usernames) {
      const res = await api()
        .post("/api/users/register")
        .send({ username: name, password: "test123" });
      expect(res.statusCode).toBe(201);
      userIds.push(res.body.id);
    }

    // Room reaches 3 players: creator (seat 0) plus two sequential joins.
    const createRes = await apiAs(userIds[0], usernames[0])
      .post("/api/rooms")
      .send({});
    expect(createRes.statusCode).toBe(201);
    const roomCode = createRes.body.code;

    for (let i = 1; i < 3; i++) {
      const joinRes = await apiAs(userIds[i], usernames[i])
        .post("/api/rooms/join")
        .send({ roomCode });
      expect(joinRes.statusCode).toBe(200);
    }

    const [res1, res2] = await Promise.all([
      apiAs(userIds[3], usernames[3]).post("/api/rooms/join").send({ roomCode }),
      apiAs(userIds[4], usernames[4]).post("/api/rooms/join").send({ roomCode }),
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([200, 400]);

    const failedRes = res1.statusCode !== 200 ? res1 : res2;
    expect(failedRes.body.error).toMatch(/full/i);

    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });
    expect(room!.players.length).toBe(4);
  });
});

async function setupTeamRace() {
  const usernames = ["teamA", "teamB", "teamC", "teamD"];
  const userIds: number[] = [];
  for (const username of usernames) {
    const response = await api()
      .post("/api/users/register")
      .send({ username, password: "test123" });
    userIds.push(response.body.id);
  }

  const created = await apiAs(userIds[0], usernames[0])
    .post("/api/rooms")
    .send({});
  const roomCode = created.body.code;
  for (let index = 1; index < userIds.length; index++) {
    await apiAs(userIds[index], usernames[index])
      .post("/api/rooms/join")
      .send({ roomCode });
  }
  return { roomCode, userIds, usernames };
}

describe("Concurrent choose-team requests", () => {
  it("allows only one concurrent third member onto a team", async () => {
    const { roomCode, userIds, usernames } = await setupTeamRace();
    await apiAs(userIds[0], usernames[0])
      .post(`/api/rooms/${roomCode}/choose-team`)
      .send({ team: 0 });

    const responses = await Promise.all([
      apiAs(userIds[1], usernames[1])
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 0 }),
      apiAs(userIds[2], usernames[2])
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 0 }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 400,
    ]);
    expect(
      await prisma.player.count({
        where: { gameRoom: { code: roomCode }, team: 0 },
      }),
    ).toBe(2);
  });

  it("keeps capacity when a switch races an unassigned player", async () => {
    const { roomCode, userIds, usernames } = await setupTeamRace();
    for (const index of [0, 1]) {
      await apiAs(userIds[index], usernames[index])
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 0 });
    }
    await apiAs(userIds[2], usernames[2])
      .post(`/api/rooms/${roomCode}/choose-team`)
      .send({ team: 1 });

    const responses = await Promise.all([
      apiAs(userIds[0], usernames[0])
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 1 }),
      apiAs(userIds[3], usernames[3])
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 1 }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 400,
    ]);
    expect(
      await prisma.player.count({
        where: { gameRoom: { code: roomCode }, team: 1 },
      }),
    ).toBe(2);
  });
});
