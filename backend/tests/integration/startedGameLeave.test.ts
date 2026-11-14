import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";
import {
  chooseBriscola,
  oneRound,
  setupGame,
} from "../helpers/gameDriver";
import { api, apiAs } from "../helpers/serverHarness";
import { clearTurnTimer, getTurnTimerState } from "../../src/runtime/turnTimer";
import { recoverRoomRuntime } from "../../src/runtime/recovery";
import { playCard } from "../../src/game/transitions/cardPlay";
import { setBriscola } from "../../src/game/transitions/round";
import { executeBotTurn } from "../../src/runtime/botExecutor";
import { playableOf, turnOf } from "../helpers/turn";
import { startBotServiceStub } from "../helpers/botServiceStub";
import * as events from "../../src/runtime/eventPublisher";

function pushedActions(publish: jest.SpyInstance, userId: number) {
  return publish.mock.calls
    .filter(([target, event]) => target === `user:${userId}` && event === "game_state")
    .map(([, , state]) => state.lastAction);
}

const originalThinkDelay = process.env.BOT_THINK_DELAY_MS;
beforeEach(async () => {
  await clearDatabase();
  process.env.BOT_THINK_DELAY_MS = "60000";
});

afterEach(async () => {
  jest.restoreAllMocks();
  if (originalThinkDelay === undefined) delete process.env.BOT_THINK_DELAY_MS;
  else process.env.BOT_THINK_DELAY_MS = originalThinkDelay;
});

async function expectStartedBotReplacement(roomCode: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { username: "userA" },
  });

  const version = async () => (await prisma.gameRoom.findUniqueOrThrow({ where: { code: roomCode } })).version;
  const before = await version();
  const response = await apiAs(user.id, user.username)
    .post(`/api/rooms/${roomCode}/leave`)
    .send({});

  expect(response.statusCode).toBe(200);
  expect(await version()).toBe(before + 1);
  expect(response.body).toEqual({ deletedRoom: false });
  expect(
    await prisma.player.count({
      where: { userId: user.id, gameRoom: { code: roomCode } },
    }),
  ).toBe(1);
  const retained = await prisma.player.findFirstOrThrow({
    where: { userId: user.id, gameRoom: { code: roomCode } },
  });
  expect(retained.botModel).toBe("forte");
  expect(retained.abandonedAt).toBeInstanceOf(Date);
  expect(retained.seat).not.toBeNull();
  const resume = await apiAs(user.id, user.username)
    .post(`/api/rooms/${roomCode}/resume-control`).send({});
  expect(resume.statusCode).toBe(403);
  const nextRoom = await apiAs(user.id, user.username).post("/api/rooms").send({});
  expect(nextRoom.statusCode).toBe(201);
}

describe("Started multiplayer leave rule", () => {
  it("ignores a bot reply that lands after its human resumed control", async () => {
    const { roomCode, round } = await setupGame();
    const { userId, version } = (await turnOf(roomCode))!;
    const player = await prisma.player.findFirstOrThrow({
      where: { userId, gameRoom: { code: roomCode } }, include: { user: true },
    });
    await prisma.player.update({ where: { id: player.id }, data: { botModel: "forte" } });
    clearTurnTimer(roomCode);

    let markRequested!: () => void;
    const requested = new Promise<void>((resolve) => { markRequested = resolve; });
    let release!: () => void;
    const response = new Promise<void>((resolve) => { release = resolve; });
    const stub = await startBotServiceStub(async () => {
      markRequested();
      await response;
      return { kind: "briscola", suit: "denara" };
    });
    const oldUrl = process.env.BOT_SERVICE_URL;
    const oldToken = process.env.BOT_SERVICE_TOKEN;
    process.env.BOT_SERVICE_URL = stub.url;
    process.env.BOT_SERVICE_TOKEN = "player-control-test";
    const executing = executeBotTurn({
      roomCode, userId, tier: "forte", phase: "choose_briscola", expectedVersion: version,
    });
    try {
      await requested;
      const resumed = await apiAs(userId, player.user.username)
        .post(`/api/rooms/${roomCode}/resume-control`).send({});
      expect(resumed.statusCode).toBe(200);
      release();
      await executing;
      expect(stub.requests).toHaveLength(1);
      expect((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).briscola).toBeNull();
      expect(await prisma.trick.count({ where: { roundId: round.id } })).toBe(0);
      const turn = (await turnOf(roomCode))!;
      expect(turn).toMatchObject({ userId, isBot: false, version: version + 1 });
      expect(getTurnTimerState(roomCode)?.version).toBe(turn.version);
    } finally {
      release();
      await executing;
      await stub.close();
      if (oldUrl === undefined) delete process.env.BOT_SERVICE_URL;
      else process.env.BOT_SERVICE_URL = oldUrl;
      if (oldToken === undefined) delete process.env.BOT_SERVICE_TOKEN;
      else process.env.BOT_SERVICE_TOKEN = oldToken;
    }
  });

  it("still sends the human a state after a bot plays their taken-over seat", async () => {
    const { roomCode } = await setupGame();
    const { userId, version } = (await turnOf(roomCode))!;
    await prisma.player.updateMany({
      where: { userId, gameRoom: { code: roomCode } }, data: { botModel: "forte" },
    });
    clearTurnTimer(roomCode);
    const stub = await startBotServiceStub(() => ({ kind: "briscola", suit: "denara" }));
    const oldUrl = process.env.BOT_SERVICE_URL;
    const oldToken = process.env.BOT_SERVICE_TOKEN;
    process.env.BOT_SERVICE_URL = stub.url;
    process.env.BOT_SERVICE_TOKEN = "player-control-test";
    const publish = jest.spyOn(events, "publishEvent");
    try {
      await executeBotTurn({
        roomCode, userId, tier: "forte", phase: "choose_briscola", expectedVersion: version,
      });
      expect(pushedActions(publish, userId)).toEqual([
        expect.objectContaining({ kind: "briscola_chosen", userId, source: "bot" }),
      ]);
    } finally {
      await stub.close();
      if (oldUrl === undefined) delete process.env.BOT_SERVICE_URL;
      else process.env.BOT_SERVICE_URL = oldUrl;
      if (oldToken === undefined) delete process.env.BOT_SERVICE_TOKEN;
      else process.env.BOT_SERVICE_TOKEN = oldToken;
    }
  });

  it("uses legal autoplay if the real bot service fails for an abandoned human seat", async () => {
    const { roomCode, round } = await setupGame();
    const { userId } = (await turnOf(roomCode))!;
    const player = await prisma.player.findFirstOrThrow({
      where: { userId, gameRoom: { code: roomCode } }, include: { user: true },
    });
    await apiAs(userId, player.user.username).post(`/api/rooms/${roomCode}/leave`).send({});
    clearTurnTimer(roomCode);
    const stub = await startBotServiceStub(() => { throw { status: 503, body: { detail: "unavailable" } }; });
    const oldUrl = process.env.BOT_SERVICE_URL;
    const oldToken = process.env.BOT_SERVICE_TOKEN;
    process.env.BOT_SERVICE_URL = stub.url;
    process.env.BOT_SERVICE_TOKEN = "player-control-test";
    const publish = jest.spyOn(events, "publishEvent");
    try {
      await executeBotTurn({
        roomCode, userId, tier: "forte", phase: "choose_briscola",
        expectedVersion: (await turnOf(roomCode))!.version,
      });
      expect(stub.requests).toHaveLength(1);
      expect((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).briscola).not.toBeNull();
      expect(pushedActions(publish, userId)).toEqual([]);
      const partner = await prisma.player.findFirstOrThrow({
        where: { gameRoom: { code: roomCode }, userId: { not: userId } },
      });
      expect(pushedActions(publish, partner.userId)).toEqual([
        expect.objectContaining({ kind: "briscola_chosen", userId, source: "bot_fallback" }),
      ]);
      expect(await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).toMatchObject({
        botModel: "forte", timeoutCount: 0,
      });
      clearTurnTimer(roomCode);
      await executeBotTurn({
        roomCode, userId, tier: "forte", phase: "play_card",
        expectedVersion: (await turnOf(roomCode))!.version,
      });
      expect(pushedActions(publish, partner.userId)[1]).toMatchObject({
        kind: "card_played", userId, source: "bot_fallback",
      });
    } finally {
      await stub.close();
      if (oldUrl === undefined) delete process.env.BOT_SERVICE_URL;
      else process.env.BOT_SERVICE_URL = oldUrl;
      if (oldToken === undefined) delete process.env.BOT_SERVICE_TOKEN;
      else process.env.BOT_SERVICE_TOKEN = oldToken;
    }
  });

  it("hands the seat to a bot in the same transaction as the third timeout", async () => {
    const { roomCode } = await setupGame();
    const turn = (await turnOf(roomCode))!;
    const player = await prisma.player.findFirstOrThrow({
      where: { userId: turn.userId, gameRoom: { code: roomCode } },
      include: { user: true },
    });
    await prisma.player.update({ where: { id: player.id }, data: { timeoutCount: 2 } });
    const publish = jest.spyOn(events, "publishEvent");
    await setBriscola({
      roomCode, userId: player.userId, source: "timeout", expectedVersion: turn.version,
    });
    expect(await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).toMatchObject({
      botModel: "forte", timeoutCount: 3, abandonedAt: null, seat: player.seat, team: player.team,
    });
    expect(pushedActions(publish, player.userId)).toEqual([
      expect.objectContaining({
        kind: "briscola_chosen", userId: player.userId, source: "timeout", takeover: true,
      }),
    ]);
    const botTurn = (await turnOf(roomCode))!;
    expect(botTurn).toMatchObject({ userId: player.userId, isBot: true, version: turn.version + 1 });
    clearTurnTimer(roomCode);
    await recoverRoomRuntime(roomCode);
    expect(getTurnTimerState(roomCode)?.version).toBe(botTurn.version);
    // The caller leads, so any card in hand is legal.
    const cards = await prisma.handCard.findMany({ where: { playerId: player.id }, select: { suit: true, value: true } });
    const denied = await apiAs(player.userId, player.user.username)
      .post(`/api/games/${roomCode}/cards`).send({ suit: cards[0].suit, value: cards[0].value });
    expect(denied.statusCode).toBe(409);

    const resumed = await apiAs(player.userId, player.user.username)
      .post(`/api/rooms/${roomCode}/resume-control`).send({});
    expect(resumed.statusCode).toBe(200);
    expect(await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).toMatchObject({
      botModel: null, timeoutCount: 0, abandonedAt: null,
    });
    const humanTurn = (await turnOf(roomCode))!;
    expect(humanTurn).toMatchObject({ userId: player.userId, isBot: false, version: botTurn.version + 1 });
    expect(getTurnTimerState(roomCode)?.version).toBe(humanTurn.version);
    await expect(playCard({
      roomCode, userId: player.userId, source: "bot", card: cards[0], expectedVersion: botTurn.version,
    })).resolves.toBeNull();
    const accepted = await apiAs(player.userId, player.user.username)
      .post(`/api/games/${roomCode}/cards`).send({ suit: cards[0].suit, value: cards[0].value });
    expect(accepted.statusCode).toBe(200);
  });

  it("persists human timeouts across runtime restoration and clears them only on a successful manual move", async () => {
    const { roomCode } = await setupGame();
    const { userId, version } = (await turnOf(roomCode))!;
    await setBriscola({ roomCode, userId, source: "timeout", expectedVersion: version });
    clearTurnTimer(roomCode);
    await recoverRoomRuntime(roomCode);
    const player = await prisma.player.findFirstOrThrow({
      where: { userId, gameRoom: { code: roomCode } }, include: { user: true },
    });
    expect(player.timeoutCount).toBe(1);
    expect(player.botModel).toBeNull();
    const [card] = await playableOf(roomCode, userId);
    const invalid = await apiAs(userId, player.user.username)
      .post(`/api/games/${roomCode}/cards`).send({ suit: "invalid", value: card.value });
    expect(invalid.statusCode).toBe(400);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).timeoutCount).toBe(1);
    const played = await apiAs(userId, player.user.username)
      .post(`/api/games/${roomCode}/cards`).send({ suit: card.suit, value: card.value });
    expect(played.statusCode).toBe(200);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).timeoutCount).toBe(0);
  });

  it("marks a timed-out card as a timeout", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    const { userId, version } = (await turnOf(roomCode))!;
    const publish = jest.spyOn(events, "publishEvent");
    await playCard({ roomCode, userId, source: "timeout", expectedVersion: version });
    expect(pushedActions(publish, userId)).toEqual([
      expect.objectContaining({ kind: "card_played", userId, source: "timeout", takeover: false }),
    ]);
  });

  it("keeps another player's deadline and rejects stale human runtime after permanent abandonment", async () => {
    const { roomCode } = await setupGame();
    const timer = getTurnTimerState(roomCode)!;
    const turn = (await turnOf(roomCode))!;
    const other = await prisma.player.findFirstOrThrow({
      where: { gameRoom: { code: roomCode }, userId: { not: turn.userId } },
      include: { user: true },
    });
    const left = await apiAs(other.userId, other.user.username)
      .post(`/api/rooms/${roomCode}/leave`).send({});
    expect(left.statusCode).toBe(200);
    expect(getTurnTimerState(roomCode)!.remainingMs).toBeLessThanOrEqual(timer.remainingMs);
    const caller = await prisma.player.findFirstOrThrow({
      where: { userId: turn.userId, gameRoom: { code: roomCode } }, include: { user: true },
    });
    const callerLeft = await apiAs(caller.userId, caller.user.username)
      .post(`/api/rooms/${roomCode}/leave`).send({});
    expect(callerLeft.statusCode).toBe(200);
    expect((await turnOf(roomCode))?.isBot).toBe(true);
    // The caller's own timer was armed before anyone left.
    await expect(setBriscola({
      roomCode, userId: caller.userId, source: "timeout", expectedVersion: turn.version,
    })).resolves.toBeNull();
    expect((await apiAs(caller.userId, caller.user.username).get(`/api/games/${roomCode}/state`)).statusCode).toBe(403);
    const rooms = await apiAs(caller.userId, caller.user.username).get("/api/rooms/available");
    expect(rooms.body.activeGames).toEqual([]);
  });

  it("permanently replaces a departing player during briscola selection", async () => {
    const { roomCode } = await setupGame();
    await expectStartedBotReplacement(roomCode);
  });

  it("permanently replaces a departing player during an active trick", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    await expectStartedBotReplacement(roomCode);
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
      expect(response.body).toEqual({ deletedRoom: false });
    }

    expect(
      await prisma.player.count({
        where: { userId: user.id, gameRoom: { code: roomCode } },
      }),
    ).toBe(1);
    expect(await prisma.playedCard.count()).toBe(40);
  });

  it("cannot start with three players when final ready races a leave", async () => {
    const users: { id: number; username: string }[] = [];
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
        .post(`/api/rooms/${roomCode}/join`)
        ;
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
      expect(leave.statusCode).toBe(200);
      expect(room.players.find((player) => player.userId === users[3].id)?.abandonedAt).not.toBeNull();
    } else {
      expect(room.players).toHaveLength(3);
      expect(leave.statusCode).toBe(200);
      expect(ready.statusCode).toBe(404);
    }
  });
});
