import { computePoints } from "../src/utils/computePoints";
import { determineHandWinner } from "../src/utils/determineHandWinner";
import { prisma } from "../src/db";
import { Suit, Value } from "@prisma/client";

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

describe("computePoints full round test", () => {
  it("should compute correct points and last hand bonus", () => {
    const allCards: { suit: Suit; value: Value }[] = [];
    const suits: Suit[] = ["coppe", "denara", "spade", "bastoni"];
    const values: Value[] = [
      "asso",
      "due",
      "tre",
      "quattro",
      "cinque",
      "sei",
      "sette",
      "fante",
      "cavallo",
      "re",
    ];

    // Generate 40 cards (4 suits x 10 values)
    for (const suit of suits) {
      for (const value of values) {
        allCards.push({ suit, value });
      }
    }

    // Shuffle cards
    const shuffled = [...allCards].sort(() => Math.random() - 0.5);

    // Simulate 4 players
    const players = [1, 2, 3, 4];
    const teamPlayers: Record<number, 0 | 1> = {
      1: 0,
      2: 1,
      3: 0,
      4: 1,
    };

    const hands = [];
    let cardIndex = 0;
    let lastWinner: number | null = null;
    const briscolaSuit: Suit = "denara";

    for (let i = 0; i < 10; i++) {
      const playedCards = players.map((playerId) => ({
        playerId,
        ...shuffled[cardIndex++],
      }));

      const winnerId = determineHandWinner(playedCards, briscolaSuit);
      hands.push({ winnerId, cards: playedCards });
      lastWinner = winnerId;
    }

    const scores = computePoints(hands, teamPlayers, "bastoni");

    // Apply end-of-round bonus
    const bonusTeam = teamPlayers[lastWinner!];
    const finalScores = {
      team0: scores.team0.points,
      team1: scores.team1.points,
    };
    finalScores[`team${bonusTeam}` as "team0" | "team1"]++;

    console.log("Raw Scores:", scores);
    console.log("Final Scores:", finalScores);

    expect(finalScores.team0 + finalScores.team1).toBe(11);
    expect(finalScores.team0).toBeGreaterThanOrEqual(0);
    expect(finalScores.team1).toBeGreaterThanOrEqual(0);
  });
});
