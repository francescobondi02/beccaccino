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
import { api, apiAs, clearDatabase } from "../helpers/gameHelpers";
import {
  ActRequest,
  BotServiceStub,
  startBotServiceStub,
  StubMove,
} from "../helpers/botServiceStub";
import { logger } from "../../src/logger";
import * as cardService from "../../src/services/cardService";
import { recoverRoomRuntime } from "../../src/runtime/recovery";

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

    const duplicate = await apiAs(userId, "pause-human")
      .post(`/api/rooms/${roomCode}/resume`)
      .send({});
    expect(duplicate.statusCode).toBe(200);

    const resumedRoom = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
    });
    expect(resumedRoom.pausedAt).toBeNull();
    expect(resumedRoom.pauseEpoch).toBe(2);
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
    const now = new Date();
    const room = await prisma.gameRoom.create({
      data: {
        code: "PAUEXP",
        started: true,
        isPractice: true,
        pausedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        players: { create: { userId, seat: 0 } },
      },
    });

    await expect(sweepPracticeRooms(now)).resolves.toBe(1);
    expect(
      await prisma.gameRoom.findUnique({ where: { id: room.id } }),
    ).toBeNull();
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

    const legalCards = await cardService.playableCards({ roomCode, userId });
    const room = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
    });
    let releaseCards!: (cards: typeof legalCards) => void;
    const heldCards = new Promise<typeof legalCards>((resolve) => {
      releaseCards = resolve;
    });
    const playableSpy = jest
      .spyOn(cardService, "playableCards")
      .mockImplementationOnce(() => heldCards);
    const cancellationLogs = jest.spyOn(logger, "debug");

    clearTurnTimer(roomCode);
    process.env.TURN_TIMEOUT_SECONDS = "0";
    startRuntimeTurn(roomCode, userId, "play_card", room.pauseEpoch);
    await waitFor(() => playableSpy.mock.calls.length === 1);

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
