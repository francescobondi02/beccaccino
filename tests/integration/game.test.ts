import {
  setupGame,
  chooseBriscola,
  oneHand,
  oneRound,
} from "../helpers/gameDriver";
import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";
import { apiAs } from "../helpers/serverHarness";
import * as events from "../../src/runtime/eventPublisher";
import * as score from "../../src/domain/game/gameScore";

beforeEach(async () => {
  await clearDatabase();
});
afterEach(() => jest.restoreAllMocks());

describe("Game flow", () => {
  it("sets up a game, chooses briscola, and plays a full round", async () => {
    const published = jest.spyOn(events, "publishEvents");
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    await oneRound(roomCode, round);
    const finished = published.mock.calls.flatMap(([batch]) => batch)
      .find((event) => event.event === "game_finished");
    expect(finished).toBeDefined();
    const player = await prisma.player.findFirstOrThrow({
      where: { gameRoom: { code: roomCode } },
      include: { user: true },
    });
    const state = await apiAs(player.userId, player.user.username).get(`/api/games/${roomCode}/state`);
    expect(state.statusCode).toBe(200);
    expect(state.body.finishedGame).toEqual(finished!.payload);
    expect(state.body.finishedGame.statistics.players).toHaveLength(4);
    expect(state.body.finishedGame.statistics.players.reduce(
      (total: number, player: { tricksWon: number }) => total + player.tricksWon, 0,
    )).toBe(10);
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
    expect(summary.body.round.deal.remainingMs).toBeGreaterThan(4000);
    expect(summary.body.round.deal.remainingMs).toBeLessThanOrEqual(8000);
    const nextRound = await prisma.round.findFirstOrThrow({
      where: { gameRoomId: round.gameRoomId, number: 2 },
    });
    await prisma.round.update({
      where: { id: nextRound.id },
      data: { createdAt: new Date(Date.now() - 4100) },
    });
    const dealing = await apiAs(player.userId, player.user.username).get(path);
    expect(dealing.body.roundSummary).toBeNull();
    expect(dealing.body.round.deal.remainingMs).toBeLessThan(4000);
    expect(dealing.body.round.deal.remainingMs).toBeGreaterThan(0);
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
    await oneHand(roomCode, round, 1);

    const afterCardPlay = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
      select: { lastActivityAt: true },
    });
    expect(afterCardPlay.lastActivityAt.getTime()).toBeGreaterThan(
      staleActivity.getTime(),
    );
  });
});
