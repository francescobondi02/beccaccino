import { prisma } from "../../src/db";
import {
  clearTurnTimer,
  getTurnTimerState,
} from "../../src/runtime/turnTimer";
import { sweepPracticeRooms } from "../../src/services/practiceRoomSweeper";
import { clearDatabase } from "../helpers/database";
import { api, apiAs } from "../helpers/serverHarness";
import {
  ActRequest,
  BotServiceStub,
  startBotServiceStub,
  StubMove,
} from "../helpers/botServiceStub";
import * as cardPlay from "../../src/game/transitions/cardPlay";
import { setPracticePaused } from "../../src/services/practiceRooms";
import { withRoomLock } from "../../src/utils/roomLock";
import { turnOf } from "../helpers/turn";
import * as eventPublisher from "../../src/runtime/eventPublisher";
import { recoverRoomRuntime } from "../../src/runtime/recovery";
import {
  getSocketInstance,
  setSocketInstance,
} from "../../src/socketInstance";

describe("Practice pause and resume", () => {
  const TOKEN = "practice-pause-token";
  let stub: BotServiceStub;
  let userId: number;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(condition: () => boolean, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (condition()) return;
      await sleep(20);
    }
    throw new Error("condition never held");
  }

  const firstLegalMove = (request: ActRequest): StubMove => {
    if (request.state.phase === "choose_briscola") {
      return {
        kind: "briscola",
        suit: request.state.hands[String(request.seat)][0].suit,
      };
    }
    const card = request.expected_legal_cards![0];
    return { kind: "card", suit: card.suit, value: card.value, signal: null };
  };

  beforeEach(async () => {
    await clearDatabase();
    process.env.BOT_THINK_DELAY_MS = "100000";
    const user = await api()
      .post("/api/users/register")
      .send({ username: "pause-human", password: "test123" });
    userId = user.body.id;
  });

  afterEach(async () => {
    await stub?.close();
    delete process.env.BOT_SERVICE_URL;
    delete process.env.BOT_SERVICE_TOKEN;
    delete process.env.BOT_THINK_DELAY_MS;
    delete process.env.TURN_TIMEOUT_SECONDS;
    jest.restoreAllMocks();
  });

  async function startPractice(
    handler: (request: ActRequest) => Promise<StubMove> | StubMove = firstLegalMove,
  ) {
    stub = await startBotServiceStub(handler, { requiredToken: TOKEN });
    process.env.BOT_SERVICE_URL = stub.url;
    process.env.BOT_SERVICE_TOKEN = TOKEN;
    const response = await apiAs(userId, "pause-human")
      .post("/api/rooms/practice")
      .send({ tier: "medio" });
    expect(response.statusCode).toBe(201);
    return response.body.code as string;
  }

  // Waits until the human must play a card, choosing briscola on the way.
  async function reachHumanCardTurn(roomCode: string) {
    for (;;) {
      const turn = await turnOf(roomCode);
      if (turn?.userId === userId && getTurnTimerState(roomCode)?.version === turn.version) {
        if (turn.phase === "play_card") return turn;
        const player = await prisma.player.findFirstOrThrow({
          where: { gameRoom: { code: roomCode }, userId },
        });
        const card = await prisma.handCard.findFirstOrThrow({ where: { playerId: player.id } });
        const chosen = await apiAs(userId, "pause-human")
          .post(`/api/games/${roomCode}/briscola`)
          .send({ suit: card.suit });
        expect(chosen.statusCode).toBe(200);
      }
      await sleep(20);
    }
  }

  it("persists pause, exposes it in state and the lobby, then resumes once", async () => {
    const roomCode = await startPractice();
    const initialTimer = getTurnTimerState(roomCode);
    expect(initialTimer).not.toBeNull();
    expect((await prisma.gameRoom.findUniqueOrThrow({ where: { code: roomCode } })).version).toBe(1);

    const paused = await apiAs(userId, "pause-human")
      .post(`/api/rooms/${roomCode}/pause`)
      .send({});
    expect(paused.statusCode).toBe(200);
    expect(paused.body).toMatchObject({ success: true, paused: true });
    expect(getTurnTimerState(roomCode)).toBeNull();

    const duplicatePause = await apiAs(userId, "pause-human")
      .post(`/api/rooms/${roomCode}/pause`)
      .send({});
    expect(duplicatePause.statusCode).toBe(200);

    const room = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
    });
    expect(room.pausedAt).not.toBeNull();
    expect(room.version).toBe(2);

    const state = await apiAs(userId, "pause-human").get(
      `/api/games/${roomCode}/state`,
    );
    expect(state.statusCode).toBe(200);
    expect(state.body).toMatchObject({
      status: "paused",
      isPractice: true,
      turn: null,
      playableCards: [],
    });
    expect(getTurnTimerState(roomCode)).toBeNull();
    expect(
      (
        await apiAs(userId, "pause-human")
          .post(`/api/games/${roomCode}/cards`)
          .send({ suit: "coppe",
            value: "asso",
          })
      ).statusCode,
    ).toBe(409);

    const lobby = await apiAs(userId, "pause-human").get("/api/rooms/available");
    expect(lobby.statusCode).toBe(200);
    expect(lobby.body.activeGames).toEqual([
      expect.objectContaining({
        code: roomCode,
        isPractice: true,
        pausedAt: room.pausedAt!.toISOString(),
      }),
    ]);

    const originalIo = getSocketInstance();
    const resumedEvents: { target: string; event: string }[] = [];
    setSocketInstance({
      to: (target: string) => ({
        emit: (event: string) => resumedEvents.push({ target, event }),
      }),
    } as any);
    try {
      const resumed = await apiAs(userId, "pause-human")
        .post(`/api/rooms/${roomCode}/resume`)
        .send({});
      expect(resumed.statusCode).toBe(200);
      expect(resumed.body).toEqual({ success: true, paused: false });
      expect(getTurnTimerState(roomCode)?.version).toBe(3);
      expect(resumedEvents).toEqual([
        { target: `user:${userId}`, event: "game_state" },
        { target: roomCode, event: "room_changed" },
        { target: "lobby", event: "lobby_changed" },
      ]);

      const duplicate = await apiAs(userId, "pause-human")
        .post(`/api/rooms/${roomCode}/resume`)
        .send({});
      expect(duplicate.statusCode).toBe(200);
      expect(resumedEvents).toHaveLength(3);
    } finally {
      setSocketInstance(originalIo);
    }

    const resumedRoom = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
    });
    expect(resumedRoom.pausedAt).toBeNull();
    expect(resumedRoom.version).toBe(3);
    // Resume starts a fresh turn: the human gets the whole time again.
    expect(resumedRoom.turnStartedAt!.getTime()).toBeGreaterThanOrEqual(room.pausedAt!.getTime());
  });

  it("pushes practice states only to the human, with their own cards and the right room code", async () => {
    const publish = jest.spyOn(eventPublisher, "publishEvent");
    const practiceCode = await startPractice();
    await apiAs(userId, "pause-human").post(`/api/rooms/${practiceCode}/pause`).send({});

    const friends = [];
    for (const username of ["friend-1", "friend-2", "friend-3"]) {
      friends.push((await api().post("/api/users/register").send({ username, password: "test123" })).body);
    }
    const created = await apiAs(userId, "pause-human").post("/api/rooms").send({});
    const multiplayerCode = created.body.code as string;
    for (const friend of friends) {
      await apiAs(friend.id, friend.username).post(`/api/rooms/${multiplayerCode}/join`);
    }
    const members = [{ id: userId, username: "pause-human" }, ...friends];
    for (const [index, member] of members.entries()) {
      await apiAs(member.id, member.username)
        .post(`/api/rooms/${multiplayerCode}/choose-team`).send({ team: index % 2 });
    }
    for (const member of members) {
      await apiAs(member.id, member.username)
        .post(`/api/rooms/${multiplayerCode}/ready`).send({ isReady: true });
    }

    const pushes = publish.mock.calls.filter(([, event]) => event === "game_state");
    const practicePushes = pushes.filter(([, , state]: any) => state.roomCode === practiceCode);
    expect(practicePushes.map(([target]) => target)).toEqual([`user:${userId}`, `user:${userId}`]);
    expect(practicePushes.map(([, , state]: any) => state.lastAction.kind)).toEqual(["game_started", "paused"]);
    const practiceCards = await prisma.handCard.findMany({
      where: { player: { userId }, round: { gameRoom: { code: practiceCode } } },
    });
    expect((practicePushes[0][2] as any).myHand).toHaveLength(10);
    expect((practicePushes[0][2] as any).myHand).toEqual(expect.arrayContaining(
      practiceCards.map(({ suit, value }) => ({ suit, value })),
    ));
    const humanMultiplayerPushes = pushes.filter(
      ([target, , state]: any) => target === `user:${userId}` && state.roomCode === multiplayerCode,
    );
    expect(humanMultiplayerPushes.map(([, , state]: any) => state.lastAction.kind)).toEqual(["game_started"]);
  });

  it("publishes pause lifecycle events only when state changes", async () => {
    const roomCode = await startPractice();
    const originalIo = getSocketInstance();
    const pausedEvents: { target: string; event: string }[] = [];
    setSocketInstance({
      to: (target: string) => ({
        emit: (event: string) => pausedEvents.push({ target, event }),
      }),
    } as any);

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(
          (
            await apiAs(userId, "pause-human")
              .post(`/api/rooms/${roomCode}/pause`)
              .send({})
          ).statusCode,
        ).toBe(200);
      }

      expect(pausedEvents).toEqual([
        { target: `user:${userId}`, event: "game_state" },
        { target: roomCode, event: "room_changed" },
        { target: "lobby", event: "lobby_changed" },
      ]);
    } finally {
      setSocketInstance(originalIo);
    }
  });

  it("keeps state reads side-effect free and recovers one runtime turn explicitly", async () => {
    const roomCode = await startPractice();
    const requestsBefore = stub.requests.length;
    clearTurnTimer(roomCode);

    const state = await apiAs(userId, "pause-human").get(
      `/api/games/${roomCode}/state`,
    );

    expect(state.statusCode).toBe(200);
    expect(getTurnTimerState(roomCode)).toBeNull();
    expect(stub.requests).toHaveLength(requestsBefore);

    await expect(recoverRoomRuntime(roomCode)).resolves.toBe(true);
    expect(getTurnTimerState(roomCode)?.version).toBe(state.body.version);
    await expect(recoverRoomRuntime(roomCode)).resolves.toBe(false);
  });

  it("rejects unauthenticated, nonmember, and multiplayer pause requests", async () => {
    const roomCode = await startPractice();
    const other = await api()
      .post("/api/users/register")
      .send({ username: "pause-other", password: "test123" });

    expect(
      (
        await api()
          .post(`/api/rooms/${roomCode}/pause`)
          .set("Cookie", "authToken=")
          .send({})
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await apiAs(other.body.id, "pause-other")
          .post(`/api/rooms/${roomCode}/pause`)
          .send({})
      ).statusCode,
    ).toBe(403);

    const multiplayer = await prisma.gameRoom.create({
      data: {
        code: "PAUM01",
        started: true,
        players: { create: { userId, seat: 0 } },
      },
    });
    const response = await apiAs(userId, "pause-human")
      .post(`/api/rooms/${multiplayer.code}/pause`)
      .send({});
    expect(response.statusCode).toBe(409);

    for (const room of [
      { code: "PAUP01", started: false, finished: false },
      { code: "PAUP02", started: true, finished: true },
    ]) {
      await prisma.gameRoom.create({
        data: {
          ...room,
          isPractice: true,
          players: { create: { userId, seat: 0 } },
        },
      });
      expect(
        (
          await apiAs(userId, "pause-human")
            .post(`/api/rooms/${room.code}/pause`)
            .send({})
        ).statusCode,
      ).toBe(409);
    }
  });

  it("refreshes activity so a newly paused room survives the stale-room sweep", async () => {
    const roomCode = await startPractice();
    const now = new Date();
    await prisma.gameRoom.update({
      where: { code: roomCode },
      data: { lastActivityAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000) },
    });

    const paused = await apiAs(userId, "pause-human")
      .post(`/api/rooms/${roomCode}/pause`)
      .send({});
    expect(paused.statusCode).toBe(200);
    await expect(sweepPracticeRooms(now)).resolves.toBe(0);
    expect(
      await prisma.gameRoom.findUnique({ where: { code: roomCode } }),
    ).toMatchObject({ finished: false });
  });

  it("lets the sweeper close a paused game after 30 days", async () => {
    const roomCode = await startPractice();
    const now = new Date();
    const paused = await apiAs(userId, "pause-human")
      .post(`/api/rooms/${roomCode}/pause`)
      .send({});
    expect(paused.statusCode).toBe(200);

    const staleAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const room = await prisma.gameRoom.update({
      where: { code: roomCode },
      data: { pausedAt: staleAt, lastActivityAt: staleAt },
    });

    await expect(sweepPracticeRooms(now)).resolves.toBe(1);
    expect(
      await prisma.gameRoom.findUnique({ where: { id: room.id } }),
    ).toMatchObject({ finished: true, winnerTeam: null });
  });

  it("keeps the practice human in control after three timeouts, so leaving closes the game", async () => {
    process.env.BOT_THINK_DELAY_MS = "20";
    const roomCode = await startPractice();
    const turn = await reachHumanCardTurn(roomCode);
    const player = await prisma.player.findFirstOrThrow({
      where: { gameRoom: { code: roomCode }, userId },
    });
    await prisma.player.update({ where: { id: player.id }, data: { timeoutCount: 2 } });

    await cardPlay.playCard({ roomCode, userId, source: "timeout", expectedVersion: turn.version });
    expect(await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).toMatchObject({
      botModel: null, timeoutCount: 3,
    });

    const left = await apiAs(userId, "pause-human")
      .post(`/api/rooms/${roomCode}/leave`)
      .send({});
    expect(left.statusCode).toBe(200);
    expect(left.body).toEqual({ deletedRoom: false });
    expect(await prisma.gameRoom.findUnique({ where: { code: roomCode } }))
      .toMatchObject({ finished: true, winnerTeam: null });
  });

  it("does not auto-play a timeout that waited on the lock through pause and resume", async () => {
    process.env.BOT_THINK_DELAY_MS = "20";
    const roomCode = await startPractice();
    const turn = await reachHumanCardTurn(roomCode);
    const playedBefore = await prisma.playedCard.count();
    const playerBefore = await prisma.player.findFirstOrThrow({ where: { gameRoom: { code: roomCode }, userId } });

    // The timer fires while a pause holds the room lock; its callback runs after the resume.
    let release!: () => void;
    const held = withRoomLock(roomCode, () => new Promise<void>((resolve) => { release = resolve; }));
    await waitFor(() => release !== undefined);
    const paused = setPracticePaused({ roomCode, userId }, true);
    const resumed = setPracticePaused({ roomCode, userId }, false);
    const timedOut = cardPlay.playCard({ roomCode, userId, source: "timeout", expectedVersion: turn.version });
    release();
    await held;
    await paused;
    await resumed;
    await expect(timedOut).resolves.toBeNull();

    expect(await prisma.playedCard.count()).toBe(playedBefore);
    expect(await prisma.player.findUniqueOrThrow({ where: { id: playerBefore.id } }))
      .toMatchObject({ timeoutCount: playerBefore.timeoutCount });
    const room = await prisma.gameRoom.findUniqueOrThrow({ where: { code: roomCode } });
    expect(room).toMatchObject({ pausedAt: null, version: turn.version + 2 });
    expect(getTurnTimerState(roomCode)).toMatchObject({ version: room.version });
    expect(getTurnTimerState(roomCode)!.remainingMs).toBeGreaterThan(59_000);
  });
});
