import request from "supertest";
import { prisma } from "../src/db";
import app from "../src/app";
import { setupGame, chooseBriscola, oneRound } from "../src/utils/testUtils";
import { computePoints } from "../src/utils/computePoints";

beforeEach(async () => {
  await prisma.playedCard.deleteMany();
  await prisma.playerCard.deleteMany();
  await prisma.hand.deleteMany();
  await prisma.round.deleteMany();
  await prisma.player.deleteMany();
  await prisma.gameRoom.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
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

      const hands = await prisma.hand.findMany({
        where: { roundId: currentRound.id },
        include: { cards: true },
      });

      const players = await prisma.player.findMany({
        where: { gameRoomId: currentRound.gameRoomId },
      });

      const teamPlayers: Record<number, number> = {};
      for (const p of players) {
        teamPlayers[p.id] = p.team!;
      }

      const lastHand = hands.reduce((max, h) =>
        h.number > max.number ? h : max
      );

      const rawPoints = computePoints(
        hands,
        teamPlayers,
        currentRound.briscola!
      );

      // Rimuovi le figure e applica bonus all'ultima mano
      let team0Cleaned = rawPoints.team0.points;
      let team1Cleaned = rawPoints.team1.points;

      if (teamPlayers[lastHand.winnerId!] === 0) {
        team0Cleaned += 1;
      } else {
        team1Cleaned += 1;
      }

      team0Total += team0Cleaned;
      team1Total += team1Cleaned;

      const roundSum = team0Cleaned + team1Cleaned;
      expect(roundSum).toBe(11); // ogni round deve sommare 11

      console.log(
        `Round ${roundCount}: Team 0 → ${team0Cleaned} / Team 1 → ${team1Cleaned} (Total: ${team0Total} - ${team1Total})`
      );

      // Prepara il prossimo round
      if (team0Total < 41 && team1Total < 41) {
        const nextRound = await prisma.round.findFirst({
          where: { gameRoomId: currentRound.gameRoomId },
          orderBy: { number: "desc" },
        });

        expect(nextRound).not.toBeNull();
        currentRound = nextRound!;

        currentCards = await prisma.playerCard.findMany({
          where: { roundId: currentRound!.id },
        });
      }
    }

    expect(team0Total >= 41 || team1Total >= 41).toBe(true);
  });
});
