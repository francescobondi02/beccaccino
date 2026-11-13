import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";
import { apiAs } from "../helpers/serverHarness";
import { BotServiceStub, startBotServiceStub } from "../helpers/botServiceStub";
import { botTierForTurn } from "../../src/runtime/botRegistry";
import { clearRuntimeRoom } from "../../src/runtime/turnRuntime";
import { getTurnTimerState } from "../../src/runtime/turnTimer";
import { recoverRoomRuntime } from "../../src/runtime/recovery";
import { executeBotTurn } from "../../src/runtime/botExecutor";
import { setRng } from "../../src/utils/random";
import * as botClient from "../../src/services/botClient";
import * as eventPublisher from "../../src/runtime/eventPublisher";

let stub: BotServiceStub;

beforeEach(async () => {
  await clearDatabase();
  stub = await startBotServiceStub(() => ({ kind: "briscola", suit: "coppe" }));
  process.env.BOT_SERVICE_URL = stub.url;
  process.env.BOT_SERVICE_TOKEN = "mixed-room-test-token";
  process.env.BOT_THINK_DELAY_MS = "60000";
});

afterEach(async () => {
  jest.restoreAllMocks();
  await stub.close();
  delete process.env.BOT_SERVICE_URL;
  delete process.env.BOT_SERVICE_TOKEN;
  delete process.env.BOT_THINK_DELAY_MS;
});

async function createLobby(teams: (number | null)[], tier: string | null = "forte") {
  const users = [];
  for (let index = 0; index < teams.length; index++) {
    users.push(await prisma.user.create({ data: { username: `human-${index}` } }));
  }
  const created = await apiAs(users[0].id, users[0].username)
    .post("/api/rooms").send({});
  expect(created.statusCode).toBe(201);
  const code: string = created.body.code;
  for (let index = 0; index < users.length; index++) {
    const user = users[index];
    if (index > 0) {
      const joined = await apiAs(user.id, user.username)
        .post("/api/rooms/join").send({ roomCode: code });
      expect(joined.statusCode).toBe(200);
    }
    if (teams[index] !== null) {
      const chosen = await apiAs(user.id, user.username)
        .post(`/api/rooms/${code}/choose-team`).send({ team: teams[index] });
      expect(chosen.statusCode).toBe(200);
    }
  }
  const configured = await apiAs(users[0].id, users[0].username)
    .post(`/api/rooms/${code}/bots`).send({ tier });
  expect(configured.statusCode).toBe(200);
  return { users, code };
}

function loadRoom(code: string) {
  return prisma.gameRoom.findUniqueOrThrow({
    where: { code },
    include: {
      players: { orderBy: { seat: "asc" }, include: { user: true } },
      rounds: true,
    },
  });
}

describe("Multiplayer bot filling", () => {
  it.each([
    [0], [1], [0, 0], [0, 1], [0, 0, 1], [1, 1, 0], [0, 1, 0, 1],
  ])("fills only missing seats for human teams %j", async (...teams: number[]) => {
    const { users, code } = await createLobby(teams);
    for (const user of users) {
      const waiting = await loadRoom(code);
      expect(waiting.started).toBe(false);
      expect(waiting.players).toHaveLength(users.length);
      expect(waiting.players.every((player) => player.botModel === null)).toBe(true);
      const ready = await apiAs(user.id, user.username)
        .post(`/api/rooms/${code}/ready`).send({ isReady: true });
      expect(ready.statusCode).toBe(200);
    }

    const room = await loadRoom(code);
    expect(room).toMatchObject({ started: true, isPractice: false, pausedAt: null });
    expect(room.players).toHaveLength(4);
    expect(room.players.map((player) => player.team)).toEqual([0, 1, 0, 1]);
    expect(room.players.map((player) => player.seat)).toEqual([0, 1, 2, 3]);
    expect(room.players.every((player) => player.isReady)).toBe(true);
    const bots = room.players.filter((player) => player.user.isBot);
    expect(bots).toHaveLength(4 - users.length);
    for (const bot of bots) {
      expect(bot.botModel).toBe("forte");
      expect(botTierForTurn(code, bot.userId)).toBe("forte");
    }
    expect(room.rounds).toHaveLength(1);
    expect(await prisma.playerCard.count({ where: { roundId: room.rounds[0].id } })).toBe(40);
    expect(stub.readyTiers).toEqual(users.length < 4 ? ["forte"] : []);
    const timer = getTurnTimerState(code)!;
    expect(timer.isBot).toBe(bots.some((bot) => bot.userId === timer.turnUserId));
  });

  it("lets a friend join instead of a virtual bot and waits for their team and readiness", async () => {
    const { users, code } = await createLobby([0]);
    const friend = await prisma.user.create({ data: { username: "friend" } });
    const joined = await apiAs(friend.id, friend.username)
      .post("/api/rooms/join").send({ roomCode: code });
    expect(joined.statusCode).toBe(200);
    expect(joined.body.players).toHaveLength(2);
    await apiAs(users[0].id, users[0].username)
      .post(`/api/rooms/${code}/ready`).send({ isReady: true });
    expect((await loadRoom(code)).started).toBe(false);
    const noTeam = await apiAs(friend.id, friend.username)
      .post(`/api/rooms/${code}/ready`).send({ isReady: true });
    expect(noTeam.statusCode).toBe(403);
    await apiAs(friend.id, friend.username)
      .post(`/api/rooms/${code}/choose-team`).send({ team: 1 });
    const ready = await apiAs(friend.id, friend.username)
      .post(`/api/rooms/${code}/ready`).send({ isReady: true });
    expect(ready.statusCode).toBe(200);
    expect((await loadRoom(code)).players.filter((player) => player.user.isBot)).toHaveLength(2);
  });

  it("persists and broadcasts settings, resets readiness only on changes, and can disable filling", async () => {
    const { users, code } = await createLobby([0, 1]);
    const client = apiAs(users[0].id, users[0].username);
    await client.post(`/api/rooms/${code}/ready`).send({ isReady: true });
    const retry = await client.post(`/api/rooms/${code}/bots`).send({ tier: "forte" });
    expect(retry.body.players.find((player: { userId: number }) => player.userId === users[0].id).isReady).toBe(true);

    const publish = jest.spyOn(eventPublisher, "publishEvent");
    const changed = await client.post(`/api/rooms/${code}/bots`).send({ tier: "medio" });
    expect(changed.statusCode).toBe(200);
    expect(changed.body.players.every((player: { isReady: boolean }) => !player.isReady)).toBe(true);
    expect(publish).toHaveBeenCalledWith(code, "room_settings_changed", {
      room: expect.objectContaining({ botTier: "medio", players: changed.body.players }),
    });
    expect((await client.get(`/api/rooms/${code}`)).body.botTier).toBe("medio");
    const disabled = await client.post(`/api/rooms/${code}/bots`).send({ tier: null });
    expect(disabled.statusCode).toBe(200);
    for (const user of users) {
      await apiAs(user.id, user.username)
        .post(`/api/rooms/${code}/ready`).send({ isReady: true });
    }
    expect(await loadRoom(code)).toMatchObject({ started: false, botTier: null });
    expect(stub.readyTiers).toHaveLength(0);
  });

  it("rejects invalid settings, nonmembers and changes after startup; mixed games cannot pause", async () => {
    const { users, code } = await createLobby([0]);
    const outsider = await prisma.user.create({ data: { username: "outsider" } });
    const denied = await apiAs(outsider.id, outsider.username)
      .post(`/api/rooms/${code}/bots`).send({ tier: "medio" });
    expect(denied.statusCode).toBe(403);
    const client = apiAs(users[0].id, users[0].username);
    for (const tier of ["unknown", 1, true, undefined]) {
      expect((await client.post(`/api/rooms/${code}/bots`).send({ tier })).statusCode).toBe(400);
    }
    await client.post(`/api/rooms/${code}/ready`).send({ isReady: true });
    expect((await client.post(`/api/rooms/${code}/bots`).send({ tier: null })).statusCode).toBe(409);
    expect((await client.post(`/api/rooms/${code}/pause`).send({})).statusCode).toBe(409);
  });

  it("leaves no ready player or bot seats after unavailable service or a failed deal, then retries", async () => {
    const { users, code } = await createLobby([0]);
    const client = apiAs(users[0].id, users[0].username);
    const readiness = jest.spyOn(botClient, "ensureBotServiceReady")
      .mockRejectedValueOnce(new botClient.BotServiceError("unavailable"));
    expect((await client.post(`/api/rooms/${code}/ready`).send({ isReady: true })).statusCode).toBe(503);
    readiness.mockRestore();

    const restoreRng = setRng(() => { throw new Error("injected deal failure"); });
    try {
      expect((await client.post(`/api/rooms/${code}/ready`).send({ isReady: true })).statusCode).toBe(500);
    } finally {
      restoreRng();
    }
    const room = await loadRoom(code);
    expect(room.started).toBe(false);
    expect(room.players).toHaveLength(1);
    expect(room.players[0].isReady).toBe(false);
    expect(room.rounds).toHaveLength(0);
    expect(getTurnTimerState(code)).toBeNull();
    expect((await client.post(`/api/rooms/${code}/ready`).send({ isReady: true })).statusCode).toBe(200);
    expect((await loadRoom(code)).started).toBe(true);
  });

  it("serializes a friend joining against the final ready without overfilling", async () => {
    const { users, code } = await createLobby([0]);
    const friend = await prisma.user.create({ data: { username: "racing-friend" } });
    const [ready, joined] = await Promise.all([
      apiAs(users[0].id, users[0].username).post(`/api/rooms/${code}/ready`).send({ isReady: true }),
      apiAs(friend.id, friend.username).post("/api/rooms/join").send({ roomCode: code }),
    ]);
    expect(ready.statusCode).toBe(200);
    const room = await loadRoom(code);
    expect(room.players).toHaveLength(room.started ? 4 : 2);
    expect(joined.statusCode).toBe(room.started ? 400 : 200);
    expect(room.players.filter((player) => player.user.isBot)).toHaveLength(room.started ? 3 : 0);
  });

  it("restores bot runtime after restart and executes a mixed-room bot move", async () => {
    const { users, code } = await createLobby([0]);
    await apiAs(users[0].id, users[0].username)
      .post(`/api/rooms/${code}/ready`).send({ isReady: true });
    const room = await loadRoom(code);
    const initialTimer = getTurnTimerState(code)!;
    expect(initialTimer.isBot).toBe(true);
    clearRuntimeRoom(code);
    expect(await recoverRoomRuntime(code)).toBe(true);
    expect(getTurnTimerState(code)).toMatchObject({
      isBot: true, turnUserId: initialTimer.turnUserId,
    });
    await executeBotTurn({
      roomCode: code,
      userId: initialTimer.turnUserId,
      tier: "forte",
      phase: "choose_briscola",
      expectedPauseEpoch: room.pauseEpoch,
      expectedTurn: { roundId: room.rounds[0].id, handId: null, playedCardCount: 0 },
    });
    expect(stub.requests).toHaveLength(1);
    expect((await loadRoom(code)).rounds[0].briscola).toBe("coppe");
  });

  it("counts finished mixed games in human statistics and rankings, but never ranks bot accounts", async () => {
    const { users, code } = await createLobby([0]);
    const client = apiAs(users[0].id, users[0].username);
    await client.post(`/api/rooms/${code}/ready`).send({ isReady: true });
    clearRuntimeRoom(code);
    const room = await loadRoom(code);
    await prisma.gameRoom.update({ where: { id: room.id }, data: { finished: true } });
    await prisma.round.update({
      where: { id: room.rounds[0].id },
      data: {
        briscola: "coppe", winnerTeam: 0, team0Points: 6, team1Points: 5,
        hands: { create: { number: 1, starterId: room.players[0].id } },
      },
    });
    const stats = await client.get("/api/users/me/stats");
    expect(stats.statusCode).toBe(200);
    expect(stats.body).toMatchObject({ totalGames: 1, wins: 1, totalPoints: 6 });
    const leaderboard = await client.get("/api/users/leaderboard");
    expect(leaderboard.statusCode).toBe(200);
    expect(leaderboard.body.leaderboard).toEqual([
      expect.objectContaining({ username: users[0].username, totalGames: 1, wins: 1 }),
    ]);
  });
});
