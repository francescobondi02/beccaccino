import {
  setupGame,
  chooseBriscola,
  oneTrick,
  oneRound,
} from "../helpers/gameDriver";
import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";
import { apiAs } from "../helpers/serverHarness";
import * as events from "../../src/runtime/eventPublisher";
import * as score from "../../src/domain/game/gameScore";
import { getSocketInstance, setSocketInstance } from "../../src/socketInstance";
import { getTurnTimerState } from "../../src/runtime/turnTimer";

beforeEach(async () => {
  await clearDatabase();
});
afterEach(() => jest.restoreAllMocks());

describe("Game flow", () => {
  it("pushes one full state per player for each move", async () => {
    const { roomCode, round, cards } = await setupGame();
    const originalIo = getSocketInstance();
    const emitted: { target: string; event: string; state: any }[] = [];
    setSocketInstance({
      to: (target: string) => ({
        emit: (event: string, state: any) => emitted.push({ target, event, state }),
      }),
    } as any);
    try {
      await chooseBriscola(roomCode, round, cards);
      await oneTrick(roomCode, round, 1);
    } finally {
      setSocketInstance(originalIo);
    }
    const players = await prisma.player.findMany({
      where: { gameRoom: { code: roomCode } }, include: { user: true },
    });
    const userTargets = players.map((player) => `user:${player.userId}`).sort();
    expect(emitted.every(({ event }) => event === "game_state")).toBe(true);
    expect(emitted).toHaveLength(5 * 4);
    const versions: number[] = [];
    for (let move = 0; move < 5; move++) {
      const batch = emitted.slice(move * 4, move * 4 + 4);
      expect(batch.map(({ target }) => target).sort()).toEqual(userTargets);
      expect(new Set(batch.map(({ state }) => state.version)).size).toBe(1);
      versions.push(batch[0].state.version);
      expect(batch[0].state.lastAction.kind).toBe(move === 0 ? "briscola_chosen" : "card_played");
      expect(batch[0].state.lastAction.source).toBe("human");
      for (const { target, state } of batch) {
        const player = players.find((candidate) => `user:${candidate.userId}` === target)!;
        const dealt = cards
          .filter((card) => card.playerId === player.id)
          .map((card) => `${card.suit}-${card.value}`);
        expect(state.myHand.length).toBeGreaterThan(8);
        expect(dealt).toEqual(expect.arrayContaining(
          state.myHand.map((card: any) => `${card.suit}-${card.value}`),
        ));
      }
    }
    expect(versions).toEqual(versions.map((_, index) => versions[0] + index));
    const caller = players.find((player) => `user:${player.userId}` === emitted[0].target)!;
    const reconnect = await apiAs(caller.userId, caller.user.username).get(`/api/games/${roomCode}/state`);
    expect(reconnect.body.version).toBe(versions[4]);
    expect(reconnect.body.lastAction).toBeNull();
  });

  it("returns the pushed state to the caller of a move", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    const sent = jest.spyOn(events, "publishEvent");
    const turnUserId = getTurnTimerState(roomCode)!.turnUserId;
    const player = await prisma.player.findFirstOrThrow({
      where: { userId: turnUserId, gameRoom: { code: roomCode } }, include: { user: true },
    });
    const before = await apiAs(player.userId, player.user.username).get(`/api/games/${roomCode}/state`);
    const card = before.body.playableCards[0];
    const played = await apiAs(player.userId, player.user.username)
      .post(`/api/games/${roomCode}/cards`).send({ suit: card.suit, value: card.value });
    expect(played.statusCode).toBe(200);
    expect(played.body.version).toBe(before.body.version + 1);
    const pushed = sent.mock.calls.find(([target]) => target === `user:${player.userId}`);
    expect(played.body).toEqual(pushed![2]);
  });

  it("returns the pushed state to the caller of briscola", async () => {
    const { roomCode } = await setupGame();
    const sent = jest.spyOn(events, "publishEvent");
    const caller = await prisma.player.findFirstOrThrow({
      where: { userId: getTurnTimerState(roomCode)!.turnUserId, gameRoom: { code: roomCode } },
      include: { user: true },
    });
    const chosen = await apiAs(caller.userId, caller.user.username)
      .post(`/api/games/${roomCode}/briscola`).send({ suit: "coppe" });
    expect(chosen.statusCode).toBe(200);
    const pushed = sent.mock.calls.find(([target]) => target === `user:${caller.userId}`);
    expect(chosen.body).toEqual(pushed![2]);
  });

  it("sets up a game, chooses briscola, and plays a full round", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    await oneRound(roomCode, round);
    const player = await prisma.player.findFirstOrThrow({
      where: { gameRoom: { code: roomCode } },
      include: { user: true },
    });
    const state = await apiAs(player.userId, player.user.username).get(`/api/games/${roomCode}/state`);
    expect(state.statusCode).toBe(200);
    expect(state.body.status).toBe("finished");
    expect(state.body.turn).toBeNull();
    expect(state.body.result.statistics.players).toHaveLength(4);
    expect(state.body.result.statistics.players.reduce(
      (total: number, player: { tricksWon: number }) => total + player.tricksWon, 0,
    )).toBe(10);
    const finalTrick = await prisma.trick.findFirstOrThrow({
      where: { roundId: round.id }, orderBy: { number: "desc" },
    });
    const winner = await prisma.player.findUniqueOrThrow({ where: { id: finalTrick.winnerId! } });
    expect(state.body.lastTrick).toMatchObject({
      roundNumber: 1, trickNumber: 10, winnerUserId: winner.userId,
    });
    expect(state.body.lastTrick.cards).toHaveLength(4);
  });

  it("recovers the round summary only during the four-second presentation window", async () => {
    jest.spyOn(score, "decideGameWinner").mockReturnValue(null);
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    await oneRound(roomCode, round);
    const player = await prisma.player.findFirstOrThrow({
      where: { gameRoom: { code: roomCode } },
      include: { user: true },
    });
    const path = `/api/games/${roomCode}/state`;
    const summary = await apiAs(player.userId, player.user.username).get(path);
    expect(summary.statusCode).toBe(200);
    expect(summary.body.roundSummary).toMatchObject({ roundNumber: 1, winnerTeam: expect.any(Number) });
    const summaryEndsAt = Date.parse(summary.body.roundSummary.visibleUntil);
    expect(summaryEndsAt - Date.parse(summary.body.serverTime)).toBeGreaterThan(0);
    expect(summaryEndsAt - Date.parse(summary.body.serverTime)).toBeLessThanOrEqual(4000);
    expect(Date.parse(summary.body.round.deal.reviewEndsAt) - summaryEndsAt).toBe(4000);
    expect(summary.body.trick).toBeNull();
    expect(summary.body.lastTrick).toMatchObject({ roundNumber: 1, trickNumber: 10 });
    expect(summary.body.lastTrick.cards).toHaveLength(4);
    const nextRound = await prisma.round.findFirstOrThrow({
      where: { gameRoomId: round.gameRoomId, number: 2 },
    });
    await prisma.round.update({
      where: { id: nextRound.id },
      data: { createdAt: new Date(Date.now() - 4100) },
    });
    const dealing = await apiAs(player.userId, player.user.username).get(path);
    expect(dealing.body.roundSummary).toBeNull();
    expect(Date.parse(dealing.body.round.deal.reviewEndsAt)).toBeGreaterThan(Date.parse(dealing.body.serverTime));
  });

  it("refreshes room activity after briscola selection and card play", async () => {
    const { roomCode, round, cards } = await setupGame();
    const staleActivity = new Date("2026-08-20T00:00:00.000Z");

    await prisma.gameRoom.update({
      where: { code: roomCode },
      data: { isPractice: true, lastActivityAt: staleActivity },
    });
    await chooseBriscola(roomCode, round, cards);

    const afterBriscola = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
      select: { lastActivityAt: true },
    });
    expect(afterBriscola.lastActivityAt.getTime()).toBeGreaterThan(
      staleActivity.getTime(),
    );

    await prisma.gameRoom.update({
      where: { code: roomCode },
      data: { lastActivityAt: staleActivity },
    });
    await oneTrick(roomCode, round, 1);

    const afterCardPlay = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
      select: { lastActivityAt: true },
    });
    expect(afterCardPlay.lastActivityAt.getTime()).toBeGreaterThan(
      staleActivity.getTime(),
    );
  });
});
