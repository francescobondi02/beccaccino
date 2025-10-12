// tests/game.test.ts
import request from "supertest";
import { prisma } from "../src/db";
import app from "../src/app";

beforeEach(async () => {
  await prisma.playedCard.deleteMany();
  await prisma.playerCard.deleteMany();
  await prisma.hand.deleteMany();
  await prisma.round.deleteMany();
  await prisma.player.deleteMany();
  await prisma.gameRoom.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Game flow", () => {
  it("Should create 4 users, one room, join all users, set teams and ready, and create the first round", async () => {
    // 1. Create 4 users
    const users = await Promise.all(
      ["A", "B", "C", "D"].map((name) =>
        request(app).post("/api/users").send({ username: name })
      )
    );
    const userIds = users.map((res) => res.body.id);

    // 2. Create a room with user A
    const createRoomRes = await request(app)
      .post("/api/rooms")
      .send({ userId: userIds[0] });
    expect(createRoomRes.statusCode).toBe(201);

    const roomCode = createRoomRes.body.code;
    expect(typeof roomCode).toBe("string");
    expect(roomCode.length).toBeGreaterThanOrEqual(6);

    // 3. Join the room with users B, C, D
    for (let i = 1; i < 4; i++) {
      const joinRes = await request(app)
        .post("/api/rooms/join")
        .send({ roomCode, userId: userIds[i] });
      expect(joinRes.statusCode).toBe(200);
    }

    // 4. Assign teams (A & C = team 0, B & D = team 1)
    await Promise.all([
      request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: userIds[0], team: 0 }),
      request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: userIds[1], team: 1 }),
      request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: userIds[2], team: 0 }),
      request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: userIds[3], team: 1 }),
    ]);

    // 5. Set all players to ready
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post(`/api/rooms/${roomCode}/ready`)
        .send({ userId: userIds[i], isReady: true });
      expect(res.statusCode).toBe(200);
    }

    // 6. Check that the gameRoom is started and that a round was created
    const finalRoom = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { rounds: true },
    });

    expect(finalRoom?.started).toBe(true);
    expect(finalRoom?.rounds.length).toBe(1);

    const round = finalRoom!.rounds[0];

    // 7. Verify the round has a hand and 40 cards distributed
    const hands = await prisma.hand.findMany({ where: { roundId: round.id } });
    expect(hands.length).toBe(1); // Just the first hand

    const cards = await prisma.playerCard.findMany({
      where: { roundId: round.id },
    });
    expect(cards.length).toBe(40);

    // 8. Make sure each player got 10 cards
    const cardsByPlayer: Record<number, number> = {};
    for (const card of cards) {
      cardsByPlayer[card.playerId] = (cardsByPlayer[card.playerId] || 0) + 1;
    }
    for (const count of Object.values(cardsByPlayer)) {
      expect(count).toBe(10);
    }
  });
});
