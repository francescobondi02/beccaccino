import { prisma } from "../../src/db";
import { playCard } from "../../src/game/transitions/cardPlay";
import { setBriscola } from "../../src/game/transitions/round";
import * as liveGame from "../../src/game/liveGame";
import { reconcileActiveRuntime } from "../../src/runtime/recovery";
import {
  clearAllTurnTimers,
  getTurnTimerState,
  scheduleTurnTimer,
} from "../../src/runtime/turnTimer";
import { clearDatabase } from "../helpers/database";
import { chooseBriscola, setupGame } from "../helpers/gameDriver";
import { apiAs } from "../helpers/serverHarness";
import { playableOf, turnOf } from "../helpers/turn";

async function userOf(userId: number) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId } });
}

describe("runtime turn identity", () => {
  const originalThinkDelay = process.env.BOT_THINK_DELAY_MS;

  beforeEach(async () => {
    await clearDatabase();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalThinkDelay === undefined) delete process.env.BOT_THINK_DELAY_MS;
    else process.env.BOT_THINK_DELAY_MS = originalThinkDelay;
  });

  it("drops deferred work armed for an older version", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    const turn = (await turnOf(roomCode))!;
    const [card] = await playableOf(roomCode, turn.userId);

    await expect(
      playCard({
        roomCode,
        userId: turn.userId,
        source: "timeout",
        card,
        expectedVersion: turn.version - 1,
      }),
    ).resolves.toBeNull();
    expect(await prisma.playedCard.count()).toBe(0);
    expect((await turnOf(roomCode))!.version).toBe(turn.version);
  });

  it("chooses briscola on a briscola timeout without playing a card", async () => {
    const { roomCode, round } = await setupGame();
    const turn = (await turnOf(roomCode))!;
    expect(turn.phase).toBe("choose_briscola");

    await setBriscola({ roomCode, userId: turn.userId, source: "timeout", expectedVersion: turn.version });

    expect(await prisma.round.findUniqueOrThrow({ where: { id: round.id } }))
      .toMatchObject({ briscolaAutoChosen: true });
    expect(await prisma.playedCard.count()).toBe(0);
    expect(await turnOf(roomCode)).toMatchObject({
      userId: turn.userId, phase: "play_card", version: turn.version + 1,
    });
    expect(getTurnTimerState(roomCode)?.version).toBe(turn.version + 1);
  });

  it("answers a human move that loses a version race with 409 and the current state", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    const turn = (await turnOf(roomCode))!;
    const [card] = await playableOf(roomCode, turn.userId);
    const user = await userOf(turn.userId);

    // Another writer commits right after this action reads the game.
    const load = liveGame.loadLiveGame;
    jest.spyOn(liveGame, "loadLiveGame").mockImplementationOnce(async (client, code) => {
      const game = await load(client, code);
      await prisma.gameRoom.update({ where: { code }, data: { version: { increment: 1 } } });
      return game;
    });

    const response = await apiAs(user.id, user.username)
      .post(`/api/games/${roomCode}/cards`)
      .send(card);

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: "La partita è cambiata. Riprova.",
      state: { roomCode, version: turn.version + 1, turn: { userId: turn.userId } },
    });
    expect(response.body.state.myHand).toHaveLength(10);
    expect(await prisma.playedCard.count()).toBe(0);
  });

  it("keeps the same deadline after a restart during a turn", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    const turn = (await turnOf(roomCode))!;
    const user = await userOf(turn.userId);
    const readDeadline = async () =>
      (await apiAs(user.id, user.username).get(`/api/games/${roomCode}/state`)).body.turn.deadline;
    const deadline = await readDeadline();
    expect(deadline).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 50));
    clearAllTurnTimers();
    await expect(reconcileActiveRuntime()).resolves.toMatchObject({ recoveredRooms: 1 });

    expect(await readDeadline()).toBe(deadline);
    const timer = getTurnTimerState(roomCode)!;
    expect(timer.version).toBe(turn.version);
    expect(Math.abs(Date.now() + timer.remainingMs - Date.parse(deadline))).toBeLessThan(1_000);
  });

  it("re-arms a missing or stale timer on the reconcile pass", async () => {
    const { roomCode } = await setupGame();
    const { version } = (await turnOf(roomCode))!;

    scheduleTurnTimer(roomCode, version - 1, 1_000_000, async () => undefined);
    await expect(reconcileActiveRuntime()).resolves.toMatchObject({ recoveredRooms: 1 });
    expect(getTurnTimerState(roomCode)?.version).toBe(version);

    clearAllTurnTimers();
    await expect(reconcileActiveRuntime()).resolves.toMatchObject({ recoveredRooms: 1 });
    expect(getTurnTimerState(roomCode)?.version).toBe(version);
    await expect(reconcileActiveRuntime()).resolves.toMatchObject({ recoveredRooms: 0 });
  });

  it("keeps a bot turn going when another seat resumes control", async () => {
    process.env.BOT_THINK_DELAY_MS = "20";
    const { roomCode, round } = await setupGame();
    const turn = (await turnOf(roomCode))!;
    const other = await prisma.player.findFirstOrThrow({
      where: { gameRoom: { code: roomCode }, userId: { not: turn.userId } },
      include: { user: true },
    });
    // Two taken-over seats; the turn seat's bot is waiting for the deal to finish.
    await prisma.player.updateMany({
      where: { gameRoom: { code: roomCode }, userId: { in: [turn.userId, other.userId] } },
      data: { botModel: "forte" },
    });
    await prisma.round.update({ where: { id: round.id }, data: { createdAt: new Date(Date.now() - 1_000) } });
    clearAllTurnTimers();
    await reconcileActiveRuntime();

    const resumed = await apiAs(other.userId, other.user.username)
      .post(`/api/rooms/${roomCode}/resume-control`).send({});
    expect(resumed.statusCode).toBe(200);
    expect(getTurnTimerState(roomCode)?.version).toBe(turn.version + 1);
    // Only the armed briscola move runs quickly.
    process.env.BOT_THINK_DELAY_MS = "60000";

    // No bot service: the bot falls back to a server-chosen briscola.
    const deadline = Date.now() + 10_000;
    while (!(await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).briscola) {
      expect(Date.now()).toBeLessThan(deadline);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await turnOf(roomCode)).toMatchObject({ userId: turn.userId, phase: "play_card", isBot: true });
  });
});
