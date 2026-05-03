import request from "supertest";
import { prisma } from "../../src/db";
import app from "../../src/app";
import { clearDatabase } from "../helpers/gameHelpers";

beforeEach(async () => {
  await clearDatabase();
});

async function createUser(username: string) {
  const res = await request(app)
    .post("/api/users/register")
    .send({ username, password: "test123" });
  expect(res.statusCode).toBe(201);
  return res.body.id;
}

describe("Room API", () => {
  describe("POST /api/rooms/ (create)", () => {
    it("creates a room and assigns the creator as seat 0", async () => {
      const userId = await createUser("creator");

      const res = await request(app)
        .post("/api/rooms/")
        .send({ userId });

      expect(res.statusCode).toBe(201);
      expect(res.body.code).toBeDefined();
      expect(res.body.code).toHaveLength(6);
      expect(res.body.players).toHaveLength(1);
      expect(res.body.players[0].userId).toBe(userId);
      expect(res.body.players[0].seat).toBe(0);
    });

    it("returns 400 without userId", async () => {
      const res = await request(app)
        .post("/api/rooms/")
        .send({});

      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/rooms/join", () => {
    it("allows a user to join an existing room", async () => {
      const creatorId = await createUser("creator");
      const joinerId = await createUser("joiner");

      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId: creatorId });
      const roomCode = createRes.body.code;

      const joinRes = await request(app)
        .post("/api/rooms/join")
        .send({ roomCode, userId: joinerId });

      expect(joinRes.statusCode).toBe(200);
      expect(joinRes.body.players).toHaveLength(2);
    });

    it("rejects joining a non-existent room", async () => {
      const userId = await createUser("lonely");

      const res = await request(app)
        .post("/api/rooms/join")
        .send({ roomCode: "ZZZZZZ", userId });

      expect(res.statusCode).toBe(404);
    });

    it("rejects joining the same room twice", async () => {
      const creatorId = await createUser("creator");

      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId: creatorId });
      const roomCode = createRes.body.code;

      const res = await request(app)
        .post("/api/rooms/join")
        .send({ roomCode, userId: creatorId });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/already/i);
    });

    it("rejects joining a full room", async () => {
      const ids = await Promise.all(
        ["A", "B", "C", "D", "E"].map((n) => createUser(n))
      );

      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId: ids[0] });
      const roomCode = createRes.body.code;

      // Fill the room
      for (let i = 1; i < 4; i++) {
        await request(app)
          .post("/api/rooms/join")
          .send({ roomCode, userId: ids[i] });
      }

      // 5th player should be rejected
      const res = await request(app)
        .post("/api/rooms/join")
        .send({ roomCode, userId: ids[4] });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/full/i);
    });
  });

  describe("POST /api/rooms/:roomCode/choose-team", () => {
    it("allows choosing a valid team", async () => {
      const userId = await createUser("player");
      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId });
      const roomCode = createRes.body.code;

      const res = await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId, team: 0 });

      expect(res.statusCode).toBe(200);
    });

    it("rejects invalid team numbers", async () => {
      const userId = await createUser("player");
      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId });
      const roomCode = createRes.body.code;

      const res = await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId, team: 5 });

      expect(res.statusCode).toBe(400);
    });

    it("rejects team if already full (2 players)", async () => {
      const ids = await Promise.all(
        ["A", "B", "C"].map((n) => createUser(n))
      );

      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId: ids[0] });
      const roomCode = createRes.body.code;

      await request(app)
        .post("/api/rooms/join")
        .send({ roomCode, userId: ids[1] });
      await request(app)
        .post("/api/rooms/join")
        .send({ roomCode, userId: ids[2] });

      // First two join team 0
      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[0], team: 0 });
      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[1], team: 0 });

      // Third should be rejected from team 0
      const res = await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[2], team: 0 });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/full/i);
    });
  });

  describe("POST /api/rooms/:roomCode/ready", () => {
    it("requires team selection before readying", async () => {
      const userId = await createUser("player");
      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId });
      const roomCode = createRes.body.code;

      const res = await request(app)
        .post(`/api/rooms/${roomCode}/ready`)
        .send({ userId, isReady: true });

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/team/i);
    });

    it("allows readying after choosing a team", async () => {
      const userId = await createUser("player");
      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId });
      const roomCode = createRes.body.code;

      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId, team: 0 });

      const res = await request(app)
        .post(`/api/rooms/${roomCode}/ready`)
        .send({ userId, isReady: true });

      expect(res.statusCode).toBe(200);
      expect(res.body.player.isReady).toBe(true);
    });
  });

  describe("Game Start Trigger (all ready with 2+2 teams)", () => {
    it("starts the game when all 4 players are ready with valid teams", async () => {
      const ids = await Promise.all(
        ["P1", "P2", "P3", "P4"].map((n) => createUser(n))
      );

      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId: ids[0] });
      const roomCode = createRes.body.code;

      for (let i = 1; i < 4; i++) {
        await request(app)
          .post("/api/rooms/join")
          .send({ roomCode, userId: ids[i] });
      }

      // Assign teams (2v2)
      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[0], team: 0 });
      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[1], team: 1 });
      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[2], team: 0 });
      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[3], team: 1 });

      // Ready up all players
      for (const id of ids) {
        const res = await request(app)
          .post(`/api/rooms/${roomCode}/ready`)
          .send({ userId: id, isReady: true });
        expect(res.statusCode).toBe(200);
      }

      // Verify game started
      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { rounds: true, players: true },
      });

      expect(room!.started).toBe(true);
      expect(room!.rounds.length).toBe(1);
      // Players should have assigned seats
      for (const player of room!.players) {
        expect(player.seat).not.toBeNull();
      }
    });

    it("does not start if teams are unbalanced (3v1)", async () => {
      const ids = await Promise.all(
        ["P1", "P2", "P3", "P4"].map((n) => createUser(n))
      );

      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId: ids[0] });
      const roomCode = createRes.body.code;

      for (let i = 1; i < 4; i++) {
        await request(app)
          .post("/api/rooms/join")
          .send({ roomCode, userId: ids[i] });
      }

      // Unbalanced teams: 3 on team 0, 1 on team 1
      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[0], team: 0 });
      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[1], team: 0 });
      // Third player tries team 0 but it's full — should fail
      const res = await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[2], team: 0 });

      expect(res.statusCode).toBe(400);
    });

    it("rejects joining a room that has already started", async () => {
      const ids = await Promise.all(
        ["P1", "P2", "P3", "P4", "P5"].map((n) => createUser(n))
      );

      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId: ids[0] });
      const roomCode = createRes.body.code;

      // Fill room with 4 players and start
      for (let i = 1; i < 4; i++) {
        await request(app)
          .post("/api/rooms/join")
          .send({ roomCode, userId: ids[i] });
      }
      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[0], team: 0 });
      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[1], team: 1 });
      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[2], team: 0 });
      await request(app)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: ids[3], team: 1 });

      for (let i = 0; i < 4; i++) {
        await request(app)
          .post(`/api/rooms/${roomCode}/ready`)
          .send({ userId: ids[i], isReady: true });
      }

      // 5th player tries to join started room
      const joinRes = await request(app)
        .post("/api/rooms/join")
        .send({ roomCode, userId: ids[4] });

      expect(joinRes.statusCode).toBe(400);
    });
  });

  describe("POST /api/rooms/:roomCode/leave", () => {
    it("removes the player from the room", async () => {
      const creatorId = await createUser("creator");
      const joinerId = await createUser("joiner");

      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId: creatorId });
      const roomCode = createRes.body.code;

      await request(app)
        .post("/api/rooms/join")
        .send({ roomCode, userId: joinerId });

      const leaveRes = await request(app)
        .post(`/api/rooms/${roomCode}/leave`)
        .send({ userId: joinerId });

      expect(leaveRes.statusCode).toBe(200);

      // Verify the room now has 1 player
      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });
      expect(room!.players).toHaveLength(1);
    });

    it("deletes the room when last player leaves", async () => {
      const userId = await createUser("lonely");

      const createRes = await request(app)
        .post("/api/rooms/")
        .send({ userId });
      const roomCode = createRes.body.code;

      await request(app)
        .post(`/api/rooms/${roomCode}/leave`)
        .send({ userId });

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
      });
      expect(room).toBeNull();
    });
  });
});
