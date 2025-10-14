import request from "supertest";
import { prisma } from "../src/db";
import app from "../src/app";
import {
  setupGame,
  chooseBriscola,
  oneRound,
  computeRoundPoints,
  prepareNextRound,
} from "../src/utils/testUtils";

beforeEach(async () => {
  await prisma.$transaction([
    prisma.playedCard.deleteMany(),
    prisma.playerCard.deleteMany(),
    prisma.hand.deleteMany(),
    prisma.round.deleteMany(),
    prisma.player.deleteMany(),
    prisma.gameRoom.deleteMany(),
    prisma.user.deleteMany(),
  ]);
});

describe("Full Beccaccino game with DB", () => {
  it("should simulate a full game until one team reaches 41 points", async () => {
    const { roomCode, round: firstRound, cards } = await setupGame();

    let team0Total = 0;
    let team1Total = 0;
    let roundCount = 0;

    let currentRound = firstRound;
    let currentCards = cards;

    while (team0Total < 41 && team1Total < 41) {
      roundCount++;

      await chooseBriscola(roomCode, currentRound, currentCards);
      await oneRound(roomCode, currentRound);

      const {
        team0Cleaned,
        team1Cleaned,
        team0Total: updatedTeam0Total,
        team1Total: updatedTeam1Total,
      } = await computeRoundPoints(
        currentRound.id,
        roundCount,
        team0Total,
        team1Total
      );

      team0Total = updatedTeam0Total;
      team1Total = updatedTeam1Total;

      // Prepara il prossimo round
      if (team0Total < 41 && team1Total < 41) {
        const { nextRound, nextCards } = await prepareNextRound(currentRound);
        currentRound = nextRound;
        currentCards = nextCards;
      }
    }

    expect(team0Total >= 41 || team1Total >= 41).toBe(true);
  });
});
