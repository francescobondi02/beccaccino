import { prisma } from "../../src/db";
import {
  clearTurnTimer,
  getTurnTimerState,
} from "../../src/runtime/turnTimer";
import {
  clearRuntimeRoom,
  startRuntimeTurn,
} from "../../src/runtime/turnRuntime";
import { sweepPracticeRooms } from "../../src/services/practiceRoomSweeper";
import { clearDatabase } from "../helpers/database";
import { api, apiAs } from "../helpers/serverHarness";
import {
  ActRequest,
  BotServiceStub,
  startBotServiceStub,
  StubMove,
} from "../helpers/botServiceStub";
import { logger } from "../../src/logger";
import * as cardQueries from "../../src/services/playableCards";
import { recoverRoomRuntime } from "../../src/runtime/recovery";
import * as turnState from "../../src/game/snapshots/turnState";
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
    const rooms = await prisma.gameRoom.findMany({ select: { code: true } });
    rooms.forEach((room) => clearRuntimeRoom(room.code));
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

  it("persists pause, exposes it in state and the lobby, then resumes once", async () => {
    const roomCode = await startPractice();
    const initialTimer = getTurnTimerState(roomCode);
    expect(initialTimer).not.toBeNull();

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
    expect(room.pauseEpoch).toBe(1);

    clearRuntimeRoom(roomCode);
    const state = await apiAs(userId, "pause-human").get(
      `/api/games/${roomCode}/state`,
    );
    expect(state.statusCode).toBe(200);
    expect(state.body).toMatchObject({
      status: "paused",
      isPractice: true,
      turnTimer: null,
    });
    expect(state.body.pausedAt).toBeTruthy();
    expect(getTurnTimerState(roomCode)).toBeNull();
    expect(
      (
        await apiAs(userId, "pause-human")
          .post("/api/games/play-card")
          .send({
            roomCode,
            suit: "coppe",
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
        pausedAt: state.body.pausedAt,
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
      const resumedTimer = getTurnTimerState(roomCode);
      expect(resumedTimer).not.toBeNull();
      expect(
        (
          await prisma.gameRoom.findUniqueOrThrow({
            where: { code: roomCode },
          })
        ).pauseEpoch,
      ).toBe(2);
      expect(
        resumedEvents.filter((event) => event.event === "practice_resumed"),
      ).toEqual([
        { target: roomCode, event: "practice_resumed" },
        { target: "lobby", event: "practice_resumed" },
      ]);

      const duplicate = await apiAs(userId, "pause-human")
        .post(`/api/rooms/${roomCode}/resume`)
        .send({});
      expect(duplicate.statusCode).toBe(200);
      expect(
        resumedEvents.filter((event) => event.event === "practice_resumed"),
      ).toHaveLength(2);
    } finally {
      setSocketInstance(originalIo);
    }

    const resumedRoom = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
    });
    expect(resumedRoom.pausedAt).toBeNull();
    expect(resumedRoom.pauseEpoch).toBe(2);
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

      expect(
        pausedEvents.filter((event) => event.event === "practice_paused"),
      ).toEqual([
        { target: roomCode, event: "practice_paused" },
        { target: "lobby", event: "practice_paused" },
      ]);
    } finally {
      setSocketInstance(originalIo);
    }
  });

  it("keeps a failed resume paused, then resumes and notifies on retry", async () => {
    const roomCode = await startPractice();
    expect(
      (
        await apiAs(userId, "pause-human")
          .post(`/api/rooms/${roomCode}/pause`)
          .send({})
      ).statusCode,
    ).toBe(200);

    const pausedRoom = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
      select: { pausedAt: true, pauseEpoch: true },
    });
    const readTurn = jest
      .spyOn(turnState, "readCurrentTurn")
      .mockResolvedValueOnce(null);
    const originalIo = getSocketInstance();
    const resumedEvents: string[] = [];
    setSocketInstance({
      to: () => ({
        emit: (event: string) => resumedEvents.push(event),
      }),
    } as any);
    try {
      const failed = await apiAs(userId, "pause-human")
        .post(`/api/rooms/${roomCode}/resume`)
        .send({});

      expect(
        await prisma.gameRoom.findUniqueOrThrow({
          where: { code: roomCode },
          select: { pausedAt: true, pauseEpoch: true },
        }),
      ).toEqual(pausedRoom);
      expect(failed.statusCode).toBe(503);
      expect(failed.body).toEqual({
        error: "Practice game runtime unavailable; retry",
      });
      expect(getTurnTimerState(roomCode)).toBeNull();
      expect(resumedEvents).not.toContain("practice_resumed");

      readTurn.mockRestore();
      const retry = await apiAs(userId, "pause-human")
        .post(`/api/rooms/${roomCode}/resume`)
        .send({});
      expect(retry.statusCode).toBe(200);
      expect(getTurnTimerState(roomCode)).not.toBeNull();
      expect(
        resumedEvents.filter((event) => event === "practice_resumed"),
      ).toHaveLength(2);
      expect(
        await prisma.gameRoom.findUniqueOrThrow({
          where: { code: roomCode },
          select: { pausedAt: true, pauseEpoch: true },
        }),
      ).toEqual({
        pausedAt: null,
        pauseEpoch: pausedRoom.pauseEpoch + 1,
      });
    } finally {
      setSocketInstance(originalIo);
    }
  });

  it("keeps state reads side-effect free and recovers one runtime turn explicitly", async () => {
    const roomCode = await startPractice();
    const requestsBefore = stub.requests.length;
    clearRuntimeRoom(roomCode);

    const state = await apiAs(userId, "pause-human").get(
      `/api/games/${roomCode}/state`,
    );

    expect(state.statusCode).toBe(200);
    expect(state.body.turnTimer).toBeNull();
    expect(getTurnTimerState(roomCode)).toBeNull();
    expect(stub.requests).toHaveLength(requestsBefore);

    await expect(recoverRoomRuntime(roomCode)).resolves.toBe(true);
    const recovered = getTurnTimerState(roomCode);
    expect(recovered).toMatchObject({
      turnUserId: state.body.currentTurnUserId,
      phase:
        state.body.round.briscola === null
          ? "choose_briscola"
          : "play_card",
    });

    await expect(recoverRoomRuntime(roomCode)).resolves.toBe(false);
    expect(getTurnTimerState(roomCode)).toMatchObject({
      turnUserId: recovered!.turnUserId,
      phase: recovered!.phase,
      totalMs: recovered!.totalMs,
    });
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
      data: { lastActivityAt: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
    });

    const paused = await apiAs(userId, "pause-human")
      .post(`/api/rooms/${roomCode}/pause`)
      .send({});
    expect(paused.statusCode).toBe(200);
    await expect(sweepPracticeRooms(now)).resolves.toBe(0);
    expect(
      await prisma.gameRoom.findUnique({ where: { code: roomCode } }),
    ).not.toBeNull();
  });

  it("lets the sweeper expire a paused room after 24 hours", async () => {
    const roomCode = await startPractice();
    const now = new Date();
    const paused = await apiAs(userId, "pause-human")
      .post(`/api/rooms/${roomCode}/pause`)
      .send({});
    expect(paused.statusCode).toBe(200);

    const staleAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const room = await prisma.gameRoom.update({
      where: { code: roomCode },
      data: { pausedAt: staleAt, lastActivityAt: staleAt },
    });

    await expect(sweepPracticeRooms(now)).resolves.toBe(1);
    expect(
      await prisma.gameRoom.findUnique({ where: { id: room.id } }),
    ).toBeNull();
  });

  it("rearms the persisted turn after timed execution fails", async () => {
    process.env.BOT_THINK_DELAY_MS = "20";
    const roomCode = await startPractice();
    await waitFor(() => {
      const timer = getTurnTimerState(roomCode);
      return Boolean(timer && !timer.isBot && timer.turnUserId === userId);
    });

    if (getTurnTimerState(roomCode)?.phase === "choose_briscola") {
      const player = await prisma.player.findFirstOrThrow({
        where: { gameRoom: { code: roomCode }, userId },
      });
      const card = await prisma.playerCard.findFirstOrThrow({
        where: { playerId: player.id },
      });
      const room = await prisma.gameRoom.findUniqueOrThrow({
        where: { code: roomCode },
      });
      expect(
        (
          await apiAs(userId, "pause-human")
            .post("/api/games/choose-briscola")
            .send({ gameRoomId: room.id, suit: card.suit })
        ).statusCode,
      ).toBe(200);
    }

    const room = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
    });
    const round = await prisma.round.findFirstOrThrow({
      where: { gameRoomId: room.id },
      orderBy: { number: "desc" },
    });
    const hand = await prisma.hand.findFirstOrThrow({
      where: { roundId: round.id },
      orderBy: { number: "desc" },
      include: { cards: true },
    });
    const playableSpy = jest
      .spyOn(cardQueries, "readPlayableCards")
      .mockRejectedValueOnce(new Error("injected card lookup failure"));

    clearTurnTimer(roomCode);
    process.env.TURN_TIMEOUT_SECONDS = "0";
    startRuntimeTurn(roomCode, userId, "play_card", room.pauseEpoch, {
      roundId: round.id,
      handId: hand.id,
      playedCardCount: hand.cards.length,
    });
    process.env.TURN_TIMEOUT_SECONDS = "100000";

    await waitFor(() => playableSpy.mock.calls.length === 1);
    await waitFor(() => {
      const timer = getTurnTimerState(roomCode);
      return Boolean(
        timer &&
          timer.turnUserId === userId &&
          timer.phase === "play_card" &&
          timer.totalMs === 100_000_000,
      );
    });
  });

  it("discards a bot response from before pause even after the room resumes", async () => {
    process.env.BOT_THINK_DELAY_MS = "200";
    let releaseMove!: (move: StubMove) => void;
    const heldMove = new Promise<StubMove>((resolve) => {
      releaseMove = resolve;
    });
    const fallbackLogs = jest.spyOn(logger, "error");
    const cancellationLogs = jest.spyOn(logger, "debug");
    const roomCode = await startPractice(() => heldMove);

    let timer = getTurnTimerState(roomCode)!;
    if (!timer.isBot) {
      if (timer.phase === "choose_briscola") {
        const player = await prisma.player.findFirstOrThrow({
          where: { gameRoom: { code: roomCode }, userId },
        });
        const card = await prisma.playerCard.findFirstOrThrow({
          where: { playerId: player.id },
        });
        const room = await prisma.gameRoom.findUniqueOrThrow({
          where: { code: roomCode },
        });
        await apiAs(userId, "pause-human")
          .post("/api/games/choose-briscola")
          .send({ gameRoomId: room.id, suit: card.suit });
      }
      const playable = await apiAs(userId, "pause-human").get(
        `/api/games/playable-cards/${roomCode}`,
      );
      const card = playable.body.playableCards[0];
      await apiAs(userId, "pause-human")
        .post("/api/games/play-card")
        .send({ roomCode, suit: card.suit, value: card.value });
    }

    await waitFor(() => stub.requests.length === 1);
    const before = {
      briscola: (
        await prisma.round.findFirstOrThrow({
          where: { gameRoom: { code: roomCode } },
        })
      ).briscola,
      playedCards: await prisma.playedCard.count({
        where: { player: { gameRoom: { code: roomCode } } },
      }),
    };

    expect(
      (
        await apiAs(userId, "pause-human")
          .post(`/api/rooms/${roomCode}/pause`)
          .send({})
      ).statusCode,
    ).toBe(200);
    process.env.BOT_THINK_DELAY_MS = "100000";
    expect(
      (
        await apiAs(userId, "pause-human")
          .post(`/api/rooms/${roomCode}/resume`)
          .send({})
      ).statusCode,
    ).toBe(200);

    const request = stub.requests[0];
    releaseMove(firstLegalMove(request));
    await waitFor(() =>
      cancellationLogs.mock.calls.some(
        (call) => call[1] === "bot_move_cancelled_by_pause",
      ),
    );

    const after = {
      briscola: (
        await prisma.round.findFirstOrThrow({
          where: { gameRoom: { code: roomCode } },
        })
      ).briscola,
      playedCards: await prisma.playedCard.count({
        where: { player: { gameRoom: { code: roomCode } } },
      }),
    };
    expect(after).toEqual(before);
    expect(
      fallbackLogs.mock.calls.some(
        (call) => call[1] === "bot_fallback_to_autoplay",
      ),
    ).toBe(false);
  });

  it("discards a human timeout already executing before pause and resume", async () => {
    process.env.BOT_THINK_DELAY_MS = "20";
    const roomCode = await startPractice();
    await waitFor(() => {
      const timer = getTurnTimerState(roomCode);
      return Boolean(timer && !timer.isBot && timer.turnUserId === userId);
    });

    if (getTurnTimerState(roomCode)?.phase === "choose_briscola") {
      const player = await prisma.player.findFirstOrThrow({
        where: { gameRoom: { code: roomCode }, userId },
      });
      const card = await prisma.playerCard.findFirstOrThrow({
        where: { playerId: player.id },
      });
      const room = await prisma.gameRoom.findUniqueOrThrow({
        where: { code: roomCode },
      });
      expect(
        (
          await apiAs(userId, "pause-human")
            .post("/api/games/choose-briscola")
            .send({ gameRoomId: room.id, suit: card.suit })
        ).statusCode,
      ).toBe(200);
    }

    const legalCards = await cardQueries.readPlayableCards({ roomCode, userId });
    const room = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
    });
    const round = await prisma.round.findFirstOrThrow({
      where: { gameRoomId: room.id },
      orderBy: { number: "desc" },
    });
    const hand = await prisma.hand.findFirstOrThrow({
      where: { roundId: round.id },
      orderBy: { number: "desc" },
      include: { cards: true },
    });
    let releaseCards!: (cards: typeof legalCards) => void;
    const heldCards = new Promise<typeof legalCards>((resolve) => {
      releaseCards = resolve;
    });
    const playableSpy = jest
      .spyOn(cardQueries, "readPlayableCards")
      .mockImplementationOnce(() => heldCards);
    const cancellationLogs = jest.spyOn(logger, "debug");

    clearTurnTimer(roomCode);
    process.env.TURN_TIMEOUT_SECONDS = "0";
    startRuntimeTurn(roomCode, userId, "play_card", room.pauseEpoch, {
      roundId: round.id,
      handId: hand.id,
      playedCardCount: hand.cards.length,
    });
    await waitFor(() => playableSpy.mock.calls.length === 1);
    await expect(recoverRoomRuntime(roomCode)).resolves.toBe(false);
    expect(getTurnTimerState(roomCode)).not.toBeNull();
    expect(playableSpy).toHaveBeenCalledTimes(1);

    const playedBefore = await prisma.playedCard.count({
      where: { player: { gameRoom: { code: roomCode } } },
    });
    expect(
      (
        await apiAs(userId, "pause-human")
          .post(`/api/rooms/${roomCode}/pause`)
          .send({})
      ).statusCode,
    ).toBe(200);
    process.env.TURN_TIMEOUT_SECONDS = "100000";
    expect(
      (
        await apiAs(userId, "pause-human")
          .post(`/api/rooms/${roomCode}/resume`)
          .send({})
      ).statusCode,
    ).toBe(200);

    releaseCards(legalCards);
    await waitFor(() =>
      cancellationLogs.mock.calls.some(
        (call) => call[1] === "auto_play_cancelled_by_pause",
      ),
    );
    expect(
      await prisma.playedCard.count({
        where: { player: { gameRoom: { code: roomCode } } },
      }),
    ).toBe(playedBefore);
  });
});
