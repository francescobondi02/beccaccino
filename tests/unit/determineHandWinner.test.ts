import { determineHandWinner } from "../../src/domain/game/determineHandWinner";
import { Suit, Value } from "@prisma/client";

describe("determineHandWinner", () => {
  it("returns highest card of the leading suit when no briscola played", () => {
    const cards = [
      { playerId: 1, suit: "coppe" as Suit, value: "sei" as Value },
      { playerId: 2, suit: "coppe" as Suit, value: "tre" as Value },
      { playerId: 3, suit: "coppe" as Suit, value: "fante" as Value },
      { playerId: 4, suit: "coppe" as Suit, value: "quattro" as Value },
    ];
    expect(determineHandWinner(cards, Suit.denara)).toBe(2);
  });

  it("ignores off-suit cards when no briscola is played", () => {
    const cards = [
      { playerId: 1, suit: "coppe" as Suit, value: "re" as Value },
      { playerId: 2, suit: "spade" as Suit, value: "tre" as Value },
      { playerId: 3, suit: "denara" as Suit, value: "tre" as Value },
      { playerId: 4, suit: "coppe" as Suit, value: "fante" as Value },
    ];
    expect(determineHandWinner(cards, Suit.bastoni)).toBe(1);
  });

  it("briscola beats the leading suit", () => {
    const cards = [
      { playerId: 1, suit: "coppe" as Suit, value: "tre" as Value },
      { playerId: 2, suit: "spade" as Suit, value: "asso" as Value },
      { playerId: 3, suit: "denara" as Suit, value: "sei" as Value },
      { playerId: 4, suit: "coppe" as Suit, value: "fante" as Value },
    ];
    expect(determineHandWinner(cards, Suit.denara)).toBe(3);
  });

  it("selects the strongest briscola when multiple are played", () => {
    const cards = [
      { playerId: 1, suit: "coppe" as Suit, value: "tre" as Value },
      { playerId: 2, suit: "denara" as Suit, value: "sei" as Value },
      { playerId: 3, suit: "denara" as Suit, value: "tre" as Value },
      { playerId: 4, suit: "coppe" as Suit, value: "asso" as Value },
    ];
    expect(determineHandWinner(cards, Suit.denara)).toBe(3);
  });

  it("throws when no cards are played", () => {
    expect(() => determineHandWinner([], Suit.coppe)).toThrow("No cards played");
  });
});
