import { computeRoundScore, settleRound } from "../../src/domain/game/roundScore";
import { determineTrickWinner } from "../../src/domain/game/trickWinner";
import { Suit, Value } from "@prisma/client";

const SUITS: Suit[] = ["coppe", "denara", "spade", "bastoni"];
const VALUES: Value[] = [
  "asso", "due", "tre", "quattro", "cinque",
  "sei", "sette", "fante", "cavallo", "re",
];

function buildDeck(): { suit: Suit; value: Value }[] {
  return SUITS.flatMap((suit) => VALUES.map((value) => ({ suit, value })));
}

// Deterministic Fisher-Yates with a simple LCG seed so failures are reproducible.
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const TEAM_PLAYERS: Record<number, 0 | 1> = { 1: 0, 2: 1, 3: 0, 4: 1 };
const PLAYERS = [1, 2, 3, 4];

describe("computeRoundScore", () => {
  it("round total always equals 35 raw (32 card points + 3 last-trick bonus)", () => {
    const deck = seededShuffle(buildDeck(), 42);
    const briscola: Suit = "denara";

    let cardIndex = 0;
    const tricks = Array.from({ length: 10 }, () => {
      const cards = PLAYERS.map((playerId) => ({
        playerId,
        ...deck[cardIndex++],
      }));
      return { winnerId: determineTrickWinner(cards, briscola), cards };
    });

    const scores = computeRoundScore(tricks, TEAM_PLAYERS);
    expect(scores.team0 + scores.team1).toBe(35);
  });

  it("all points go to the team that wins every trick", () => {
    // Arrange the full 40-card deck so team 0 (players 1 & 3) always wins:
    // give them the asso of each suit in the first two positions so player 1
    // always leads and wins with the highest card.
    const deck = seededShuffle(buildDeck(), 7);
    // Sort so that for each group of 4, player 1 gets the highest card.
    let idx = 0;
    const tricks = Array.from({ length: 10 }, () => {
      const group = deck.slice(idx, idx + 4);
      idx += 4;
      // Manually assign winner to player 1 (team 0) for all tricks.
      return {
        winnerId: 1,
        cards: group.map((card, i) => ({ playerId: PLAYERS[i], ...card })),
      };
    });

    const scores = computeRoundScore(tricks, TEAM_PLAYERS);
    // team 0 wins everything: all 40 cards + last-trick bonus
    expect(scores.team0).toBe(35);
    expect(scores.team1).toBe(0);
  });

  it("last-trick bonus goes to the correct team", () => {
    // 9 tricks won by team 0 (player 1), last trick won by team 1 (player 2)
    const makeTrick = (winner: number) => ({
      winnerId: winner,
      cards: [
        { playerId: winner, suit: "coppe" as Suit, value: "asso" as Value },
        { playerId: winner === 1 ? 2 : 1, suit: "coppe" as Suit, value: "quattro" as Value },
        { playerId: 3, suit: "bastoni" as Suit, value: "cinque" as Value },
        { playerId: 4, suit: "bastoni" as Suit, value: "cinque" as Value },
      ],
    });

    const tricks = [
      ...Array.from({ length: 9 }, () => makeTrick(1)),
      makeTrick(2),
    ];

    const scores = computeRoundScore(tricks, TEAM_PLAYERS);
    // team 1 gets its asso plus the last-trick bonus
    expect(scores).toEqual({ team0: 27, team1: 6 });
  });

  it("raw total is always 35 across multiple random seeds", () => {
    const deck = buildDeck();
    for (const seed of [1, 7, 99, 1234, 99999]) {
      const shuffled = seededShuffle(deck, seed);
      let idx = 0;
      const tricks = Array.from({ length: 10 }, () => {
        const cards = PLAYERS.map((playerId) => ({ playerId, ...shuffled[idx++] }));
        return { winnerId: determineTrickWinner(cards, "coppe" as Suit), cards };
      });
      const scores = computeRoundScore(tricks, TEAM_PLAYERS);
      expect(scores.team0 + scores.team1).toBe(35);
    }
  });
});

describe("settleRound", () => {
  it("adds the cricca bonus to the caller team before choosing the winner", () => {
    expect(settleRound({ team0: 19, team1: 16 }, 1)).toEqual({
      team0Raw: 19,
      team1Raw: 25,
      winnerTeam: 1,
    });
  });

  it("breaks equal points by figures", () => {
    expect(settleRound({ team0: 16, team1: 17 }, null).winnerTeam).toBe(1);
  });

  it("awards an exact tie to team 0", () => {
    expect(settleRound({ team0: 16, team1: 16 }, null).winnerTeam).toBe(0);
  });
});
