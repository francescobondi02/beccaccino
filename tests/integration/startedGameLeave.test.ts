import { prisma } from "../../src/db";
import { clearRuntimeRoom } from "../../src/runtime/turnRuntime";
import { clearDatabase } from "../helpers/database";
import {
  chooseBriscola,
  oneRound,
  setupGame,
} from "../helpers/gameDriver";
import { api, apiAs } from "../helpers/serverHarness";

beforeEach(async () => {
  await clearDatabase();
});

afterEach(async () => {
  const rooms = await prisma.gameRoom.findMany({ select: { code: true } });
  for (const room of rooms) clearRuntimeRoom(room.code);
});

async function expectStartedLeaveRejected(roomCode: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { username: "userA" },
  });

  const response = await apiAs(user.id, user.username)
    .post(`/api/rooms/${roomCode}/leave`)
    .send({});

  expect(response.statusCode).toBe(409);
  expect(response.body.error).toMatch(/active multiplayer/i);
  expect(
    await prisma.player.count({
      where: { userId: user.id, gameRoom: { code: roomCode } },
    }),
  ).toBe(1);
}

describe("Started multiplayer leave rule", () => {
  it("rejects leaving during briscola selection", async () => {
    const { roomCode } = await setupGame();
    await expectStartedLeaveRejected(roomCode);
  });

  it("rejects leaving during an active hand", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    await expectStartedLeaveRejected(roomCode);
  });

  it("returns success after finish without deleting historical membership", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    await oneRound(roomCode, round);
    const user = await prisma.user.findUniqueOrThrow({
      where: { username: "userA" },
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await apiAs(user.id, user.username)
        .post(`/api/rooms/${roomCode}/leave`)
        .send({});
      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({
        deletedRoom: false,
        preservedHistory: true,
      });
    }

    expect(
      await prisma.player.count({
        where: { userId: user.id, gameRoom: { code: roomCode } },
      }),
    ).toBe(1);
    expect(await prisma.playedCard.count()).toBe(40);
  });

  it("cannot start with three players when final ready races a leave", async () => {
    const users = [];
    for (const username of ["raceA", "raceB", "raceC", "raceD"]) {
      const response = await api()
        .post("/api/users/register")
        .send({ username, password: "test123" });
      users.push({ id: response.body.id, username });
    }

    const created = await apiAs(users[0].id, users[0].username)
      .post("/api/rooms")
      .send({});
    const roomCode = created.body.code;
    for (let index = 1; index < users.length; index++) {
      await apiAs(users[index].id, users[index].username)
        .post("/api/rooms/join")
        .send({ roomCode });
    }
    for (let index = 0; index < users.length; index++) {
      await apiAs(users[index].id, users[index].username)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ team: index % 2 });
    }
    for (let index = 0; index < users.length - 1; index++) {
      await apiAs(users[index].id, users[index].username)
        .post(`/api/rooms/${roomCode}/ready`)
        .send({ isReady: true });
    }

    const [ready, leave] = await Promise.all([
      apiAs(users[3].id, users[3].username)
        .post(`/api/rooms/${roomCode}/ready`)
        .send({ isReady: true }),
      apiAs(users[3].id, users[3].username)
        .post(`/api/rooms/${roomCode}/leave`)
        .send({}),
    ]);
    const room = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
      include: { players: true },
    });

    if (room.started) {
      expect(room.players).toHaveLength(4);
      expect(ready.statusCode).toBe(200);
      expect(leave.statusCode).toBe(409);
    } else {
      expect(room.players).toHaveLength(3);
      expect(leave.statusCode).toBe(200);
      expect(ready.statusCode).toBe(404);
    }
  });
});
