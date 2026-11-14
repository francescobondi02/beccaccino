import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";
import {
  setupGame,
  chooseBriscola,
  oneRound,
  prepareNextRound,
  expectStoredResult,
} from "../helpers/gameDriver";
import { setupRound } from "../../src/game/transitions/round";
import { apiAs } from "../helpers/serverHarness";

// tests/loadTestEnv.ts sets the winning score to 5.
const WINNING_SCORE = 5;

beforeEach(async () => {
  await clearDatabase();
});

describe("Full Beccaccino game", () => {
  it("plays to the target and stores each round score and the winner", async () => {
    let { roomCode, round, cards } = await setupGame();
    for (;;) {
      await chooseBriscola(roomCode, round, cards);
      await oneRound(roomCode, round);
      const room = await prisma.gameRoom.findUniqueOrThrow({ where: { code: roomCode } });
      if (room.finished) break;
      ({ nextRound: round, nextCards: cards } = await prepareNextRound(round));
    }
    await expectStoredResult(roomCode);
  });

  it("stores the caller: the quattro di denara holder, then the next seat", async () => {
    const { roomCode, round, cards } = await setupGame();
    const quattro = cards.find((card) => card.suit === "denara" && card.value === "quattro")!;
    expect(round.callerId).toBe(quattro.playerId);

    const room = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
      include: { players: true },
    });
    await prisma.$transaction((tx) => setupRound(room.id, 2, tx));
    const second = await prisma.round.findFirstOrThrow({ where: { gameRoomId: room.id, number: 2 } });
    const seatOf = (playerId: number) =>
      room.players.find((player) => player.id === playerId)!.seat!;
    expect(seatOf(second.callerId)).toBe((seatOf(round.callerId) + 1) % 4);
  });

  it("maintains consistent game state throughout the game", async () => {
    const { roomCode, round: firstRound, cards } = await setupGame();

    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: { include: { user: true } } },
    });

    const p0 = room!.players[0];

    // Verify initial state via API
    const initialState = await apiAs(p0.userId, p0.user.username)
      .get(`/api/games/${roomCode}/state`);

    expect(initialState.statusCode).toBe(200);
    expect(initialState.body.round.number).toBe(1);
    expect(initialState.body.round.briscola).toBeNull();
    expect(initialState.body.myHand.length).toBe(10);
    expect(initialState.body.score.team0.points).toBe(0);
    expect(initialState.body.score.team1.points).toBe(0);

    // Choose briscola
    await chooseBriscola(roomCode, firstRound, cards);

    // Verify state after briscola
    const afterBriscola = await apiAs(p0.userId, p0.user.username)
      .get(`/api/games/${roomCode}/state`);

    expect(afterBriscola.body.round.briscola).not.toBeNull();
    expect(typeof afterBriscola.body.turn.userId).toBe("number");

    // Play the full round
    await oneRound(roomCode, firstRound);

    // Verify state after round completion
    const afterRound = await apiAs(p0.userId, p0.user.username)
      .get(`/api/games/${roomCode}/state`);

    // After a round ends, either the game is finished or a new round started
    const gameRoom = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
    });

    if (gameRoom!.finished) {
      // Game is over — totalPoints should reflect the win
      const score = afterRound.body.score;
      expect(
        score.team0.points >= WINNING_SCORE ||
          score.team1.points >= WINNING_SCORE
      ).toBe(true);
      expect(afterRound.body.status).toBe("finished");
      expect(afterRound.body.turn).toBeNull();
      expect(afterRound.body.result).toMatchObject({
        winnerTeam: expect.any(Number),
        totalRounds: expect.any(Number),
        finalScores: {
          team0: score.team0.points,
          team1: score.team1.points,
        },
        roundsWon: {
          team0: expect.any(Number),
          team1: expect.any(Number),
        },
      });
    } else {
      // New round started
      expect(afterRound.body.round.number).toBe(2);
      expect(afterRound.body.myHand.length).toBe(10); // Fresh 10 cards
      expect(afterRound.body.round.briscola).toBeNull(); // Not yet chosen
    }
  });

  it("each player always has 10 cards at round start and cards decrease as played", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);

    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: { include: { user: true } } },
    });

    // Verify each player has 10 cards
    for (const player of room!.players) {
      const stateRes = await apiAs(player.userId, player.user.username)
        .get(`/api/games/${roomCode}/state`);

      expect(stateRes.body.myHand.length).toBe(10);
    }

    const p0 = room!.players[0];

    // Play 4 cards (one full trick)
    for (let i = 0; i < 4; i++) {
      const currentState = await apiAs(p0.userId, p0.user.username)
        .get(`/api/games/${roomCode}/state`);

      const turnUserId = currentState.body.turn.userId;
      const turnPlayer = room!.players.find((p) => p.userId === turnUserId)!;

      const playableRes = await apiAs(turnPlayer.userId, turnPlayer.user.username)
        .get(`/api/games/${roomCode}/state`);

      const card = playableRes.body.playableCards[0];
      await apiAs(turnPlayer.userId, turnPlayer.user.username)
        .post(`/api/games/${roomCode}/cards`)
        .send({ suit: card.suit,
          value: card.value,
        });
    }

    // After one trick, each player should have 9 cards
    for (const player of room!.players) {
      const stateRes = await apiAs(player.userId, player.user.username)
        .get(`/api/games/${roomCode}/state`);

      expect(stateRes.body.myHand.length).toBe(9);
    }
  });

  it("returns the persisted lead signal to reconnecting players", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    const room = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
      include: { players: { include: { user: true } } },
    });
    const observer = room.players[0];
    const state = await apiAs(observer.userId, observer.user.username).get(
      `/api/games/${roomCode}/state`,
    );
    const leader = room.players.find(
      (player) => player.userId === state.body.turn.userId,
    )!;
    const playable = await apiAs(leader.userId, leader.user.username).get(
      `/api/games/${roomCode}/state`,
    );
    const card = playable.body.playableCards[0];

    const played = await apiAs(leader.userId, leader.user.username)
      .post(`/api/games/${roomCode}/cards`)
      .send({ suit: card.suit,
        value: card.value,
        signal: "busso",
      });
    expect(played.statusCode).toBe(200);

    const reconnected = await apiAs(
      observer.userId,
      observer.user.username,
    ).get(`/api/games/${roomCode}/state`);
    expect(reconnected.statusCode).toBe(200);
    expect(reconnected.body.trick).toMatchObject({
      number: 1,
      cards: [{ userId: leader.userId, signal: "busso" }],
    });
  });
});
