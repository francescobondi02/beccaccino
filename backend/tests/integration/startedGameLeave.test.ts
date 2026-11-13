import { prisma } from "../../src/db";
import { clearRuntimeRoom } from "../../src/runtime/turnRuntime";
import { clearDatabase } from "../helpers/database";
import {
  chooseBriscola,
  oneRound,
  setupGame,
} from "../helpers/gameDriver";
import { api, apiAs } from "../helpers/serverHarness";
import { executeTimedOutTurn } from "../../src/runtime/timeoutExecutor";
import { clearTurnTimer, getTurnTimerState } from "../../src/runtime/turnTimer";
import { recoverRoomRuntime } from "../../src/runtime/recovery";
import { readPlayableCards } from "../../src/services/playableCards";
import { playCard } from "../../src/game/transitions/cardPlay";
import { RuntimeTurnCancelledError, setBriscola } from "../../src/game/transitions/round";
import { botTierForTurn } from "../../src/runtime/botRegistry";
import { executeBotTurn } from "../../src/runtime/botExecutor";
import { changePlayerControl } from "../../src/services/playerControl";
import { startBotServiceStub } from "../helpers/botServiceStub";

const originalThinkDelay = process.env.BOT_THINK_DELAY_MS;
beforeEach(async () => {
  await clearDatabase();
  process.env.BOT_THINK_DELAY_MS = "60000";
});

afterEach(async () => {
  const rooms = await prisma.gameRoom.findMany({ select: { code: true } });
  for (const room of rooms) clearRuntimeRoom(room.code);
  if (originalThinkDelay === undefined) delete process.env.BOT_THINK_DELAY_MS;
  else process.env.BOT_THINK_DELAY_MS = originalThinkDelay;
});

async function expectStartedBotReplacement(roomCode: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { username: "userA" },
  });

  const response = await apiAs(user.id, user.username)
    .post(`/api/rooms/${roomCode}/leave`)
    .send({});

  expect(response.statusCode).toBe(200);
  expect(response.body).toMatchObject({ preservedHistory: true, abandoned: true });
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
  it("completes an AFK takeover interrupted after the third timeout was committed", async () => {
    const { roomCode } = await setupGame();
    const userId = getTurnTimerState(roomCode)!.turnUserId;
    const player = await prisma.player.findFirstOrThrow({ where: { userId, gameRoom: { code: roomCode } } });
    await prisma.player.update({ where: { id: player.id }, data: { timeoutCount: 3 } });
    clearRuntimeRoom(roomCode);
    await recoverRoomRuntime(roomCode);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).botModel).toBe("forte");
    expect(getTurnTimerState(roomCode)).toMatchObject({ turnUserId: userId, isBot: true });
  });

  it("cancels a real bot response already in flight when its human reclaims the seat", async () => {
    const { roomCode, round } = await setupGame();
    const userId = getTurnTimerState(roomCode)!.turnUserId;
    const player = await prisma.player.findFirstOrThrow({
      where: { userId, gameRoom: { code: roomCode } }, include: { user: true },
    });
    await prisma.player.update({ where: { id: player.id }, data: { timeoutCount: 3 } });
    await changePlayerControl({ roomCode, userId, action: "timeout" });
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
      roomCode, userId, tier: "forte", phase: "choose_briscola", expectedPauseEpoch: 0,
      expectedTurn: { roundId: round.id, handId: null, playedCardCount: 0 },
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
      expect(await prisma.hand.count({ where: { roundId: round.id } })).toBe(0);
      expect(getTurnTimerState(roomCode)).toMatchObject({ turnUserId: userId, isBot: false });
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

  it("uses legal autoplay if the real bot service fails for an abandoned human seat", async () => {
    const { roomCode, round } = await setupGame();
    const userId = getTurnTimerState(roomCode)!.turnUserId;
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
    try {
      await executeBotTurn({
        roomCode, userId, tier: "forte", phase: "choose_briscola", expectedPauseEpoch: 0,
        expectedTurn: { roundId: round.id, handId: null, playedCardCount: 0 },
      });
      expect(stub.requests).toHaveLength(1);
      expect((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).briscola).not.toBeNull();
      expect(await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).toMatchObject({
        botModel: "forte", timeoutCount: 0,
      });
    } finally {
      await stub.close();
      if (oldUrl === undefined) delete process.env.BOT_SERVICE_URL;
      else process.env.BOT_SERVICE_URL = oldUrl;
      if (oldToken === undefined) delete process.env.BOT_SERVICE_TOKEN;
      else process.env.BOT_SERVICE_TOKEN = oldToken;
    }
  });

  it("persists the third timeout as a real bot seat, restores it, and lets the human reclaim control", async () => {
    const { roomCode, round } = await setupGame();
    const timer = getTurnTimerState(roomCode)!;
    const player = await prisma.player.findFirstOrThrow({
      where: { userId: timer.turnUserId, gameRoom: { code: roomCode } },
      include: { user: true },
    });
    await prisma.player.update({ where: { id: player.id }, data: { timeoutCount: 2 } });
    await executeTimedOutTurn({
      roomCode, userId: player.userId, phase: "choose_briscola", expectedPauseEpoch: 0,
      expectedTurn: { roundId: round.id, handId: null, playedCardCount: 0 },
    });
    expect(await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).toMatchObject({
      botModel: "forte", timeoutCount: 3, abandonedAt: null, seat: player.seat, team: player.team,
    });
    expect(getTurnTimerState(roomCode)).toMatchObject({ turnUserId: player.userId, isBot: true });
    clearRuntimeRoom(roomCode);
    await recoverRoomRuntime(roomCode);
    expect(botTierForTurn(roomCode, player.userId)).toBe("forte");
    expect(getTurnTimerState(roomCode)?.isBot).toBe(true);
    const cards = await readPlayableCards({ roomCode, userId: player.userId });
    const hand = await prisma.hand.findFirstOrThrow({ where: { roundId: round.id } });
    const denied = await apiAs(player.userId, player.user.username)
      .post("/api/games/play-card").send({ roomCode, suit: cards[0].suit, value: cards[0].value });
    expect(denied.statusCode).toBe(409);

    const resumed = await apiAs(player.userId, player.user.username)
      .post(`/api/rooms/${roomCode}/resume-control`).send({});
    expect(resumed.statusCode).toBe(200);
    expect(await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).toMatchObject({
      botModel: null, timeoutCount: 0, abandonedAt: null,
    });
    expect(botTierForTurn(roomCode, player.userId)).toBeNull();
    expect(getTurnTimerState(roomCode)).toMatchObject({ turnUserId: player.userId, isBot: false });
    await expect(playCard({
      roomCode, userId: player.userId, suit: cards[0].suit, value: cards[0].value,
      expectedBotModel: "forte",
      expectedTurn: { roundId: round.id, handId: hand.id, playedCardCount: 0 },
    })).rejects.toBeInstanceOf(RuntimeTurnCancelledError);
    const accepted = await apiAs(player.userId, player.user.username)
      .post("/api/games/play-card").send({ roomCode, suit: cards[0].suit, value: cards[0].value });
    expect(accepted.statusCode).toBe(200);
  });

  it("persists human timeouts across runtime restoration and clears them only on a successful manual move", async () => {
    const { roomCode, round } = await setupGame();
    const userId = getTurnTimerState(roomCode)!.turnUserId;
    await executeTimedOutTurn({
      roomCode, userId, phase: "choose_briscola", expectedPauseEpoch: 0,
      expectedTurn: { roundId: round.id, handId: null, playedCardCount: 0 },
    });
    clearRuntimeRoom(roomCode);
    await recoverRoomRuntime(roomCode);
    const player = await prisma.player.findFirstOrThrow({
      where: { userId, gameRoom: { code: roomCode } }, include: { user: true },
    });
    expect(player.timeoutCount).toBe(1);
    expect(player.botModel).toBeNull();
    const [card] = await readPlayableCards({ roomCode, userId });
    const invalid = await apiAs(userId, player.user.username)
      .post("/api/games/play-card").send({ roomCode, suit: "invalid", value: card.value });
    expect(invalid.statusCode).toBe(400);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).timeoutCount).toBe(1);
    const played = await apiAs(userId, player.user.username)
      .post("/api/games/play-card").send({ roomCode, suit: card.suit, value: card.value });
    expect(played.statusCode).toBe(200);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).timeoutCount).toBe(0);
  });

  it("keeps another player's deadline and rejects stale human runtime after permanent abandonment", async () => {
    const { roomCode, round } = await setupGame();
    const timer = getTurnTimerState(roomCode)!;
    const other = await prisma.player.findFirstOrThrow({
      where: { gameRoom: { code: roomCode }, userId: { not: timer.turnUserId } },
      include: { user: true },
    });
    const left = await apiAs(other.userId, other.user.username)
      .post(`/api/rooms/${roomCode}/leave`).send({});
    expect(left.statusCode).toBe(200);
    expect(getTurnTimerState(roomCode)!.remainingMs).toBeLessThanOrEqual(timer.remainingMs);
    const caller = await prisma.player.findFirstOrThrow({
      where: { userId: timer.turnUserId, gameRoom: { code: roomCode } }, include: { user: true },
    });
    const callerLeft = await apiAs(caller.userId, caller.user.username)
      .post(`/api/rooms/${roomCode}/leave`).send({});
    expect(callerLeft.statusCode).toBe(200);
    expect(getTurnTimerState(roomCode)?.isBot).toBe(true);
    await expect(setBriscola({
      gameRoomId: caller.gameRoomId, playerId: caller.id, suit: "denara",
      expectedBotModel: null,
      expectedTurn: { roundId: round.id, handId: null, playedCardCount: 0 },
    })).rejects.toBeInstanceOf(RuntimeTurnCancelledError);
    expect((await apiAs(caller.userId, caller.user.username).get(`/api/games/${roomCode}/state`)).statusCode).toBe(403);
    expect((await apiAs(caller.userId, caller.user.username).get(`/api/games/playable-cards/${roomCode}`)).statusCode).toBe(403);
    const rooms = await apiAs(caller.userId, caller.user.username).get("/api/rooms/available");
    expect(rooms.body.activeGames).toEqual([]);
  });

  it("permanently replaces a departing player during briscola selection", async () => {
    const { roomCode } = await setupGame();
    await expectStartedBotReplacement(roomCode);
  });

  it("permanently replaces a departing player during an active hand", async () => {
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
      expect(leave.statusCode).toBe(200);
      expect(room.players.find((player) => player.userId === users[3].id)?.abandonedAt).not.toBeNull();
    } else {
      expect(room.players).toHaveLength(3);
      expect(leave.statusCode).toBe(200);
      expect(ready.statusCode).toBe(404);
    }
  });
});
