import { determineHandWinner } from "../src/utils/determineHandWinner";
import { Suit, Value } from "@prisma/client";

describe("Hand winner logic", () => {
  it("should return the index of the highest card of the starting suit if no briscola is played", () => {
    const playedCards = [
      { playerId: 1, suit: "coppe" as Suit, value: "sei" as Value },
      { playerId: 2, suit: "coppe" as Suit, value: "tre" as Value }, // strongest
      { playerId: 3, suit: "coppe" as Suit, value: "fante" as Value },
      { playerId: 4, suit: "coppe" as Suit, value: "quattro" as Value },
    ];

    const winner = determineHandWinner(playedCards, Suit.denara);
    expect(winner).toBe(2); // playerId 2
  });

  it("should ignore cards of different suits if no briscola", () => {
    const playedCards = [
      { playerId: 1, suit: "coppe" as Suit, value: "re" as Value }, // strongest
      { playerId: 2, suit: "spade" as Suit, value: "tre" as Value },
      { playerId: 3, suit: "denara" as Suit, value: "tre" as Value },
      { playerId: 4, suit: "coppe" as Suit, value: "fante" as Value },
    ];

    const winner = determineHandWinner(playedCards, Suit.bastoni);
    expect(winner).toBe(1); // playerId 1
  });

  it("should let briscola win even if not matching starting suit", () => {
    const playedCards = [
      { playerId: 1, suit: "coppe" as Suit, value: "tre" as Value },
      { playerId: 2, suit: "spade" as Suit, value: "asso" as Value },
      { playerId: 3, suit: "denara" as Suit, value: "sei" as Value }, // briscola
      { playerId: 4, suit: "coppe" as Suit, value: "fante" as Value },
    ];

    const winner = determineHandWinner(playedCards, Suit.denara);
    expect(winner).toBe(3); // playerId 3
  });

  it("should select strongest briscola if multiple are played", () => {
    const playedCards = [
      { playerId: 1, suit: "coppe" as Suit, value: "tre" as Value },
      { playerId: 2, suit: "denara" as Suit, value: "sei" as Value },
      { playerId: 3, suit: "denara" as Suit, value: "tre" as Value }, // stronger
      { playerId: 4, suit: "coppe" as Suit, value: "asso" as Value },
    ];

    const winner = determineHandWinner(playedCards, Suit.denara);
    expect(winner).toBe(3); // playerId 3
  });

  it("should throw if no cards are played", () => {
    expect(() => determineHandWinner([], Suit.coppe)).toThrow(
      "No cards played"
    );
  });
});
