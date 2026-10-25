import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";
import {
  setupGame,
  chooseBriscola,
  oneRound,
  computeRoundPoints,
  prepareNextRound,
} from "../helpers/gameDriver";
import { apiAs } from "../helpers/serverHarness";

// tests/loadTestEnv.ts sets the winning score to 5.
const WINNING_SCORE = 5;

beforeEach(async () => {
  await clearDatabase();
});

describe("Full Beccaccino game", () => {
  it("plays until one team reaches the winning score and round totals always equal 11", async () => {
    const { roomCode, round: firstRound, cards } = await setupGame();

    let team0Total = 0;
    let team1Total = 0;
    let roundCount = 0;
    let currentRound = firstRound;
    let currentCards = cards;

    while (team0Total < WINNING_SCORE && team1Total < WINNING_SCORE) {
      roundCount++;
      await chooseBriscola(roomCode, currentRound, currentCards);
      await oneRound(roomCode, currentRound);

      ({ team0Total, team1Total } = await computeRoundPoints(
        currentRound.id,
        roundCount,
        team0Total,
        team1Total
      ));

      if (team0Total < WINNING_SCORE && team1Total < WINNING_SCORE) {
        ({ nextRound: currentRound, nextCards: currentCards } =
          await prepareNextRound(currentRound));
      }
    }

    expect(team0Total >= WINNING_SCORE || team1Total >= WINNING_SCORE).toBe(true);
  });

  it("marks the game as finished when a team wins", async () => {
    const { roomCode, round: firstRound, cards } = await setupGame();

    let team0Total = 0;
    let team1Total = 0;
    let currentRound = firstRound;
    let currentCards = cards;
    let roundCount = 0;

    while (team0Total < WINNING_SCORE && team1Total < WINNING_SCORE) {
      roundCount++;
      await chooseBriscola(roomCode, currentRound, currentCards);
      await oneRound(roomCode, currentRound);

      ({ team0Total, team1Total } = await computeRoundPoints(
        currentRound.id,
        roundCount,
        team0Total,
        team1Total
      ));

      if (team0Total < WINNING_SCORE && team1Total < WINNING_SCORE) {
        ({ nextRound: currentRound, nextCards: currentCards } =
          await prepareNextRound(currentRound));
      }
    }

    // Verify the game room is marked as finished
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
    });
    expect(room!.finished).toBe(true);
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
    expect(initialState.body.myCards.length).toBe(10);
    expect(initialState.body.totalPoints.team0Points).toBe(0);
    expect(initialState.body.totalPoints.team1Points).toBe(0);

    // Choose briscola
    await chooseBriscola(roomCode, firstRound, cards);

    // Verify state after briscola
    const afterBriscola = await apiAs(p0.userId, p0.user.username)
      .get(`/api/games/${roomCode}/state`);

    expect(afterBriscola.body.round.briscola).not.toBeNull();
    expect(afterBriscola.body.currentTurnUserId).toBeDefined();
    expect(typeof afterBriscola.body.currentTurnUserId).toBe("number");

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
      const totalPoints = afterRound.body.totalPoints;
      expect(
        totalPoints.team0Points >= WINNING_SCORE ||
          totalPoints.team1Points >= WINNING_SCORE
      ).toBe(true);
      expect(afterRound.body.status).toBe("finished");
      expect(afterRound.body.currentTurnUserId).toBeNull();
      expect(afterRound.body.finishedGame).toMatchObject({
        winnerTeam: expect.any(Number),
        totalRounds: expect.any(Number),
        finalScores: {
          team0: totalPoints.team0Points,
          team1: totalPoints.team1Points,
        },
        roundsWon: {
          team0: expect.any(Number),
          team1: expect.any(Number),
        },
      });
    } else {
      // New round started
      expect(afterRound.body.round.number).toBe(2);
      expect(afterRound.body.myCards.length).toBe(10); // Fresh 10 cards
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

      expect(stateRes.body.myCards.length).toBe(10);
    }

    const p0 = room!.players[0];

    // Play 4 cards (one full hand)
    for (let i = 0; i < 4; i++) {
      const currentState = await apiAs(p0.userId, p0.user.username)
        .get(`/api/games/${roomCode}/state`);

      const turnUserId = currentState.body.currentTurnUserId;
      const turnPlayer = room!.players.find((p) => p.userId === turnUserId)!;

      const playableRes = await apiAs(turnPlayer.userId, turnPlayer.user.username)
        .get(`/api/games/playable-cards/${roomCode}`);

      const card = playableRes.body.playableCards[0];
      await apiAs(turnPlayer.userId, turnPlayer.user.username)
        .post("/api/games/play-card")
        .send({
          roomCode,
          suit: card.suit,
          value: card.value,
        });
    }

    // After one hand, each player should have 9 cards
    for (const player of room!.players) {
      const stateRes = await apiAs(player.userId, player.user.username)
        .get(`/api/games/${roomCode}/state`);

      expect(stateRes.body.myCards.length).toBe(9);
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
      (player) => player.userId === state.body.currentTurnUserId,
    )!;
    const playable = await apiAs(leader.userId, leader.user.username).get(
      `/api/games/playable-cards/${roomCode}`,
    );
    const card = playable.body.playableCards[0];

    const played = await apiAs(leader.userId, leader.user.username)
      .post("/api/games/play-card")
      .send({
        roomCode,
        suit: card.suit,
        value: card.value,
        signal: "busso",
      });
    expect(played.statusCode).toBe(200);

    const reconnected = await apiAs(
      observer.userId,
      observer.user.username,
    ).get(`/api/games/${roomCode}/state`);
    expect(reconnected.statusCode).toBe(200);
    expect(reconnected.body.playedCards[0]).toMatchObject({
      userId: leader.userId,
      position: 0,
      signal: "busso",
      handNumber: 1,
    });
  });

  it("total card points per round always sum to 11", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    await oneRound(roomCode, round);

    // Get the round scores from the database
    const completedRound = await prisma.round.findUnique({
      where: { id: round.id },
    });

    expect(completedRound!.winnerTeam).not.toBeNull();
    expect(completedRound!.team0Points + completedRound!.team1Points).toBe(11);
  });
});
