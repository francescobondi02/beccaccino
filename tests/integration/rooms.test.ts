import { prisma } from "../../src/db";
import { clearDatabase, api, apiAs } from "../helpers/gameHelpers";

beforeEach(async () => {
  await clearDatabase();
});

async function createUser(username: string): Promise<{
  id: number;
  username: string;
}> {
  const res = await api()
    .post("/api/users/register")
    .send({ username, password: "test123" });
  expect(res.statusCode).toBe(201);
  return { id: res.body.id, username };
}

function expectPublicPlayers(players: Array<Record<string, unknown>>) {
  for (const player of players) {
    expect(Object.keys(player).sort()).toEqual([
      "id",
      "isReady",
      "seat",
      "team",
      "user",
      "userId",
    ]);
    expect(Object.keys(player.user as Record<string, unknown>).sort()).toEqual([
      "id",
      "username",
    ]);
  }
}

describe("Room API", () => {
  describe("POST /api/rooms/ (create)", () => {
    it("creates a room and assigns the creator as seat 0", async () => {
      const user = await createUser("creator");

      const res = await apiAs(user.id, user.username).post("/api/rooms/").send({});

      expect(res.statusCode).toBe(201);
      expect(res.body.code).toBeDefined();
      expect(res.body.code).toHaveLength(6);
      expect(res.body.players).toHaveLength(1);
      expect(res.body.players[0].userId).toBe(user.id);
      expect(res.body.players[0].seat).toBe(0);
      expectPublicPlayers(res.body.players);
    });

    it("returns the existing room code when the user has an active game", async () => {
      const user = await createUser("activeCreator");
      const activeRoom = await apiAs(user.id, user.username)
        .post("/api/rooms")
        .send({});
      await prisma.gameRoom.update({
        where: { code: activeRoom.body.code },
        data: { started: true },
      });

      const res = await apiAs(user.id, user.username)
        .post("/api/rooms")
        .send({});

      expect(res.statusCode).toBe(409);
      expect(res.body.activeRoomCode).toBe(activeRoom.body.code);
    });
  });

  describe("GET /api/rooms/:roomCode", () => {
    it("returns only public player fields", async () => {
      const user = await createUser("creator");
      const createRes = await apiAs(user.id, user.username)
        .post("/api/rooms/")
        .send({});

      const res = await apiAs(user.id, user.username).get(
        `/api/rooms/${createRes.body.code}`,
      );

      expect(res.statusCode).toBe(200);
      expectPublicPlayers(res.body.players);
    });
  });

  describe("POST /api/rooms/join", () => {
    it("allows a user to join an existing room", async () => {
      const creator = await createUser("creator");
      const joiner = await createUser("joiner");

      const createRes = await apiAs(creator.id, creator.username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      const joinRes = await apiAs(joiner.id, joiner.username)
        .post("/api/rooms/join")
        .send({ roomCode });

      expect(joinRes.statusCode).toBe(200);
      expect(joinRes.body.players).toHaveLength(2);
      expectPublicPlayers(joinRes.body.players);
    });

    it("rejects joining a non-existent room", async () => {
      const user = await createUser("lonely");

      const res = await apiAs(user.id, user.username)
        .post("/api/rooms/join")
        .send({ roomCode: "ZZZZZZ" });

      expect(res.statusCode).toBe(404);
    });

    it("rejects joining the same room twice", async () => {
      const creator = await createUser("creator");

      const createRes = await apiAs(creator.id, creator.username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      const res = await apiAs(creator.id, creator.username)
        .post("/api/rooms/join")
        .send({ roomCode });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/already/i);
    });

    it("rejects joining a full room", async () => {
      const users = await Promise.all(
        ["userA", "userB", "userC", "userD", "userE"].map((n) => createUser(n))
      );

      const createRes = await apiAs(users[0].id, users[0].username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      // Fill the room
      for (let i = 1; i < 4; i++) {
        await apiAs(users[i].id, users[i].username)
          .post("/api/rooms/join")
          .send({ roomCode });
      }

      // 5th player should be rejected
      const res = await apiAs(users[4].id, users[4].username)
        .post("/api/rooms/join")
        .send({ roomCode });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/full/i);
    });

    it("returns the existing room code when the user joins during an active game", async () => {
      const activeUser = await createUser("activeJoiner");
      const targetOwner = await createUser("targetOwner");
      const activeRoom = await apiAs(activeUser.id, activeUser.username)
        .post("/api/rooms")
        .send({});
      const targetRoom = await apiAs(targetOwner.id, targetOwner.username)
        .post("/api/rooms")
        .send({});
      await prisma.gameRoom.update({
        where: { code: activeRoom.body.code },
        data: { started: true },
      });

      const res = await apiAs(activeUser.id, activeUser.username)
        .post("/api/rooms/join")
        .send({ roomCode: targetRoom.body.code });

      expect(res.statusCode).toBe(409);
      expect(res.body.activeRoomCode).toBe(activeRoom.body.code);
    });
  });

  describe("POST /api/rooms/:roomCode/choose-team", () => {
    it("allows choosing a valid team", async () => {
      const user = await createUser("player");
      const createRes = await apiAs(user.id, user.username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      const res = await apiAs(user.id, user.username)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 0 });

      expect(res.statusCode).toBe(200);
    });

    it("rejects invalid team numbers", async () => {
      const user = await createUser("player");
      const createRes = await apiAs(user.id, user.username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      const res = await apiAs(user.id, user.username)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 5 });

      expect(res.statusCode).toBe(400);
    });

    it("rejects team if already full (2 players)", async () => {
      const users = await Promise.all(
        ["userA", "userB", "userC"].map((n) => createUser(n))
      );

      const createRes = await apiAs(users[0].id, users[0].username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      await apiAs(users[1].id, users[1].username)
        .post("/api/rooms/join")
        .send({ roomCode });
      await apiAs(users[2].id, users[2].username)
        .post("/api/rooms/join")
        .send({ roomCode });

      // First two join team 0
      await apiAs(users[0].id, users[0].username)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 0 });
      await apiAs(users[1].id, users[1].username)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 0 });

      // Third should be rejected from team 0
      const res = await apiAs(users[2].id, users[2].username)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 0 });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/full/i);
    });

    it("treats a same-team retry as a successful no-op", async () => {
      const users = await Promise.all(
        ["retryA", "retryB"].map((name) => createUser(name)),
      );
      const created = await apiAs(users[0].id, users[0].username)
        .post("/api/rooms")
        .send({});
      await apiAs(users[1].id, users[1].username)
        .post("/api/rooms/join")
        .send({ roomCode: created.body.code });
      for (const user of users) {
        await apiAs(user.id, user.username)
          .post(`/api/rooms/${created.body.code}/choose-team`)
          .send({ team: 0 });
      }

      const retry = await apiAs(users[0].id, users[0].username)
        .post(`/api/rooms/${created.body.code}/choose-team`)
        .send({ team: 0 });

      expect(retry.statusCode).toBe(200);
      expect(retry.body.player.team).toBe(0);
    });

    it("rejects changing team after the game has started", async () => {
      const user = await createUser("startedPlayer");
      const created = await apiAs(user.id, user.username)
        .post("/api/rooms")
        .send({});
      await apiAs(user.id, user.username)
        .post(`/api/rooms/${created.body.code}/choose-team`)
        .send({ team: 0 });
      await prisma.gameRoom.update({
        where: { code: created.body.code },
        data: { started: true },
      });

      const response = await apiAs(user.id, user.username)
        .post(`/api/rooms/${created.body.code}/choose-team`)
        .send({ team: 1 });

      expect(response.statusCode).toBe(409);
      expect(response.body.error).toMatch(/started/i);
    });
  });

  describe("POST /api/rooms/:roomCode/ready", () => {
    it("requires team selection before readying", async () => {
      const user = await createUser("player");
      const createRes = await apiAs(user.id, user.username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      const res = await apiAs(user.id, user.username)
        .post(`/api/rooms/${roomCode}/ready`)
        .send({ isReady: true });

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/team/i);
    });

    it("allows readying after choosing a team", async () => {
      const user = await createUser("player");
      const createRes = await apiAs(user.id, user.username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      await apiAs(user.id, user.username)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 0 });

      const res = await apiAs(user.id, user.username)
        .post(`/api/rooms/${roomCode}/ready`)
        .send({ isReady: true });

      expect(res.statusCode).toBe(200);
      expect(res.body.player.isReady).toBe(true);
    });

    it("treats a same-ready retry as a successful no-op", async () => {
      const user = await createUser("readyRetry");
      const created = await apiAs(user.id, user.username)
        .post("/api/rooms")
        .send({});
      await apiAs(user.id, user.username)
        .post(`/api/rooms/${created.body.code}/choose-team`)
        .send({ team: 0 });

      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await apiAs(user.id, user.username)
          .post(`/api/rooms/${created.body.code}/ready`)
          .send({ isReady: true });
        expect(response.statusCode).toBe(200);
        expect(response.body.player.isReady).toBe(true);
      }
    });

    it("rejects invalid ready values", async () => {
      const user = await createUser("invalidReady");
      const created = await apiAs(user.id, user.username)
        .post("/api/rooms")
        .send({});

      const response = await apiAs(user.id, user.username)
        .post(`/api/rooms/${created.body.code}/ready`)
        .send({ isReady: "yes" });

      expect(response.statusCode).toBe(400);
      expect(response.body.error).toMatch(/ready status/i);
    });

    it("rejects changing ready state after startup", async () => {
      const user = await createUser("startedReady");
      const created = await apiAs(user.id, user.username)
        .post("/api/rooms")
        .send({});
      await prisma.player.updateMany({
        where: { gameRoom: { code: created.body.code } },
        data: { team: 0, isReady: true },
      });
      await prisma.gameRoom.update({
        where: { code: created.body.code },
        data: { started: true },
      });

      const response = await apiAs(user.id, user.username)
        .post(`/api/rooms/${created.body.code}/ready`)
        .send({ isReady: false });

      expect(response.statusCode).toBe(409);
      expect(response.body.error).toMatch(/started/i);
    });
  });

  describe("Game Start Trigger (all ready with 2+2 teams)", () => {
    it("starts the game when all 4 players are ready with valid teams", async () => {
      const users = await Promise.all(
        ["player1", "player2", "player3", "player4"].map((n) => createUser(n))
      );

      const createRes = await apiAs(users[0].id, users[0].username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      for (let i = 1; i < 4; i++) {
        await apiAs(users[i].id, users[i].username)
          .post("/api/rooms/join")
          .send({ roomCode });
      }

      // Assign teams (2v2)
      const teams = [0, 1, 0, 1];
      for (let i = 0; i < 4; i++) {
        await apiAs(users[i].id, users[i].username)
          .post(`/api/rooms/${roomCode}/choose-team`)
          .send({ team: teams[i] });
      }

      // Ready up all players
      for (const user of users) {
        const res = await apiAs(user.id, user.username)
          .post(`/api/rooms/${roomCode}/ready`)
          .send({ isReady: true });
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
      const users = await Promise.all(
        ["player1", "player2", "player3", "player4"].map((n) => createUser(n))
      );

      const createRes = await apiAs(users[0].id, users[0].username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      for (let i = 1; i < 4; i++) {
        await apiAs(users[i].id, users[i].username)
          .post("/api/rooms/join")
          .send({ roomCode });
      }

      // Unbalanced teams: 3 on team 0, 1 on team 1
      await apiAs(users[0].id, users[0].username)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 0 });
      await apiAs(users[1].id, users[1].username)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 0 });
      // Third player tries team 0 but it's full — should fail
      const res = await apiAs(users[2].id, users[2].username)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: 0 });

      expect(res.statusCode).toBe(400);
    });

    it("rejects joining a room that has already started", async () => {
      const users = await Promise.all(
        ["player1", "player2", "player3", "player4", "player5"].map((n) => createUser(n))
      );

      const createRes = await apiAs(users[0].id, users[0].username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      // Fill room with 4 players and start
      for (let i = 1; i < 4; i++) {
        await apiAs(users[i].id, users[i].username)
          .post("/api/rooms/join")
          .send({ roomCode });
      }
      const teams = [0, 1, 0, 1];
      for (let i = 0; i < 4; i++) {
        await apiAs(users[i].id, users[i].username)
          .post(`/api/rooms/${roomCode}/choose-team`)
          .send({ team: teams[i] });
      }

      for (let i = 0; i < 4; i++) {
        await apiAs(users[i].id, users[i].username)
          .post(`/api/rooms/${roomCode}/ready`)
          .send({ isReady: true });
      }

      // 5th player tries to join started room
      const joinRes = await apiAs(users[4].id, users[4].username)
        .post("/api/rooms/join")
        .send({ roomCode });

      expect(joinRes.statusCode).toBe(400);
    });
  });

  describe("POST /api/rooms/:roomCode/leave", () => {
    it("removes the player from the room", async () => {
      const creator = await createUser("creator");
      const joiner = await createUser("joiner");

      const createRes = await apiAs(creator.id, creator.username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      await apiAs(joiner.id, joiner.username)
        .post("/api/rooms/join")
        .send({ roomCode });

      const leaveRes = await apiAs(joiner.id, joiner.username)
        .post(`/api/rooms/${roomCode}/leave`)
        .send({});

      expect(leaveRes.statusCode).toBe(200);

      // Verify the room now has 1 player
      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });
      expect(room!.players).toHaveLength(1);
    });

    it("deletes the room when last player leaves", async () => {
      const user = await createUser("lonely");

      const createRes = await apiAs(user.id, user.username)
        .post("/api/rooms/")
        .send({});
      const roomCode = createRes.body.code;

      await apiAs(user.id, user.username)
        .post(`/api/rooms/${roomCode}/leave`)
        .send({});

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
      });
      expect(room).toBeNull();
    });
  });
});
