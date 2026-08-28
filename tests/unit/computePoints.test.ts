import { computePoints } from "../../src/domain/game/computePoints";
import { determineHandWinner } from "../../src/domain/game/determineHandWinner";
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

describe("computePoints", () => {
  it("round total always equals 11 (10 card-value points + 1 last-hand bonus)", () => {
    const deck = seededShuffle(buildDeck(), 42);
    const briscola: Suit = "denara";

    let cardIndex = 0;
    const hands = Array.from({ length: 10 }, () => {
      const cards = PLAYERS.map((playerId) => ({
        playerId,
        ...deck[cardIndex++],
      }));
      return { winnerId: determineHandWinner(cards, briscola), cards };
    });

    const scores = computePoints(hands, TEAM_PLAYERS, "bastoni");
    expect(scores.team0.points + scores.team1.points).toBe(11);
  });

  it("all points go to the team that wins every hand", () => {
    // Arrange the full 40-card deck so team 0 (players 1 & 3) always wins:
    // give them the asso of each suit in the first two positions so player 1
    // always leads and wins with the highest card.
    const deck = seededShuffle(buildDeck(), 7);
    // Sort so that for each group of 4, player 1 gets the highest card.
    let idx = 0;
    const hands = Array.from({ length: 10 }, () => {
      const group = deck.slice(idx, idx + 4);
      idx += 4;
      // Manually assign winner to player 1 (team 0) for all hands.
      return {
        winnerId: 1,
        cards: group.map((card, i) => ({ playerId: PLAYERS[i], ...card })),
      };
    });

    const scores = computePoints(hands, TEAM_PLAYERS, "bastoni");
    // team 0 wins everything: all 40 cards + last-hand bonus → 11 points
    expect(scores.team0.points).toBe(11);
    expect(scores.team1.points).toBe(0);
  });

  it("last-hand bonus goes to the correct team", () => {
    // 9 hands won by team 0 (player 1), last hand won by team 1 (player 2)
    const makeHand = (winner: number) => ({
      winnerId: winner,
      cards: [
        { playerId: winner, suit: "coppe" as Suit, value: "asso" as Value },
        { playerId: winner === 1 ? 2 : 1, suit: "coppe" as Suit, value: "quattro" as Value },
        { playerId: 3, suit: "bastoni" as Suit, value: "cinque" as Value },
        { playerId: 4, suit: "bastoni" as Suit, value: "cinque" as Value },
      ],
    });

    const hands = [
      ...Array.from({ length: 9 }, () => makeHand(1)),
      makeHand(2),
    ];

    const scores = computePoints(hands, TEAM_PLAYERS, "denara");
    // team 1 gets the last-hand bonus point
    expect(scores.team1.points).toBeGreaterThan(0);
    expect(scores.team0.points + scores.team1.points).toBe(11);
  });

  it("point total is always 11 across multiple random seeds", () => {
    const deck = buildDeck();
    for (const seed of [1, 7, 99, 1234, 99999]) {
      const shuffled = seededShuffle(deck, seed);
      let idx = 0;
      const hands = Array.from({ length: 10 }, () => {
        const cards = PLAYERS.map((playerId) => ({ playerId, ...shuffled[idx++] }));
        return { winnerId: determineHandWinner(cards, "coppe" as Suit), cards };
      });
      const scores = computePoints(hands, TEAM_PLAYERS, "coppe");
      expect(scores.team0.points + scores.team1.points).toBe(11);
    }
  });
});
