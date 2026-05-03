import { prisma } from "../../src/db";
import {
  clearDatabase,
  setupGame,
  chooseBriscola,
  oneRound,
  computeRoundPoints,
  prepareNextRound,
  api,
} from "../helpers/gameHelpers";

// Game service ends the game at 5 points (see gameService.ts).
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
      include: { players: true },
    });

    // Verify initial state via API
    const initialState = await api()
      .get(`/api/games/${roomCode}/state`)
      .query({ userId: room!.players[0].userId });

    expect(initialState.statusCode).toBe(200);
    expect(initialState.body.round.number).toBe(1);
    expect(initialState.body.round.briscola).toBeNull();
    expect(initialState.body.myCards.length).toBe(10);
    expect(initialState.body.totalPoints.team0Points).toBe(0);
    expect(initialState.body.totalPoints.team1Points).toBe(0);

    // Choose briscola
    await chooseBriscola(roomCode, firstRound, cards);

    // Verify state after briscola
    const afterBriscola = await api()
      .get(`/api/games/${roomCode}/state`)
      .query({ userId: room!.players[0].userId });

    expect(afterBriscola.body.round.briscola).not.toBeNull();
    expect(afterBriscola.body.currentTurnUserId).toBeDefined();
    expect(typeof afterBriscola.body.currentTurnUserId).toBe("number");

    // Play the full round
    await oneRound(roomCode, firstRound);

    // Verify state after round completion
    const afterRound = await api()
      .get(`/api/games/${roomCode}/state`)
      .query({ userId: room!.players[0].userId });

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
      include: { players: true },
    });

    // Verify each player has 10 cards
    for (const player of room!.players) {
      const stateRes = await api()
        .get(`/api/games/${roomCode}/state`)
        .query({ userId: player.userId });

      expect(stateRes.body.myCards.length).toBe(10);
    }

    // Play one hand (4 cards total — 1 per player)
    const stateRes = await api()
      .get(`/api/games/${roomCode}/state`)
      .query({ userId: room!.players[0].userId });

    // Play 4 cards (one full hand)
    for (let i = 0; i < 4; i++) {
      const currentState = await api()
        .get(`/api/games/${roomCode}/state`)
        .query({ userId: room!.players[0].userId });

      const turnUserId = currentState.body.currentTurnUserId;

      const playableRes = await api()
        .get(`/api/games/playable-cards/${roomCode}`)
        .query({ userId: turnUserId });

      const card = playableRes.body.playableCards[0];
      await api().post("/api/games/play-card").send({
        roomCode,
        userId: turnUserId,
        suit: card.suit,
        value: card.value,
      });
    }

    // After one hand, each player should have 9 cards
    for (const player of room!.players) {
      const stateRes = await api()
        .get(`/api/games/${roomCode}/state`)
        .query({ userId: player.userId });

      expect(stateRes.body.myCards.length).toBe(9);
    }
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
