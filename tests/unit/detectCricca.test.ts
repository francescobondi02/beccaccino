import { detectCricca } from "../../src/utils/detectCricca";
import { Suit, Value } from "@prisma/client";

describe("detectCricca", () => {
  it("returns true when caller has tre, due, asso of briscola suit", () => {
    const cards = [
      { suit: "denara" as Suit, value: "tre" as Value },
      { suit: "denara" as Suit, value: "due" as Value },
      { suit: "denara" as Suit, value: "asso" as Value },
      { suit: "denara" as Suit, value: "quattro" as Value },
      { suit: "spade" as Suit, value: "re" as Value },
      { suit: "coppe" as Suit, value: "fante" as Value },
      { suit: "bastoni" as Suit, value: "sette" as Value },
      { suit: "coppe" as Suit, value: "cinque" as Value },
      { suit: "spade" as Suit, value: "sei" as Value },
      { suit: "bastoni" as Suit, value: "cavallo" as Value },
    ];
    expect(detectCricca(cards, "denara")).toBe(true);
  });

  it("returns false when missing one of the three cards", () => {
    const cards = [
      { suit: "denara" as Suit, value: "tre" as Value },
      { suit: "denara" as Suit, value: "due" as Value },
      // Missing asso of denara
      { suit: "denara" as Suit, value: "quattro" as Value },
      { suit: "spade" as Suit, value: "asso" as Value }, // asso but wrong suit
      { suit: "coppe" as Suit, value: "re" as Value },
      { suit: "bastoni" as Suit, value: "fante" as Value },
      { suit: "spade" as Suit, value: "sette" as Value },
      { suit: "coppe" as Suit, value: "cinque" as Value },
      { suit: "spade" as Suit, value: "sei" as Value },
      { suit: "bastoni" as Suit, value: "cavallo" as Value },
    ];
    expect(detectCricca(cards, "denara")).toBe(false);
  });

  it("returns false when cards are of briscola suit but not the right values", () => {
    const cards = [
      { suit: "coppe" as Suit, value: "re" as Value },
      { suit: "coppe" as Suit, value: "cavallo" as Value },
      { suit: "coppe" as Suit, value: "fante" as Value },
      { suit: "coppe" as Suit, value: "sette" as Value },
      { suit: "denara" as Suit, value: "asso" as Value },
      { suit: "denara" as Suit, value: "tre" as Value },
      { suit: "spade" as Suit, value: "due" as Value },
      { suit: "bastoni" as Suit, value: "quattro" as Value },
      { suit: "spade" as Suit, value: "cinque" as Value },
      { suit: "bastoni" as Suit, value: "sei" as Value },
    ];
    expect(detectCricca(cards, "coppe")).toBe(false);
  });

  it("checks against the correct briscola suit, not other suits", () => {
    const cards = [
      { suit: "spade" as Suit, value: "tre" as Value },
      { suit: "spade" as Suit, value: "due" as Value },
      { suit: "spade" as Suit, value: "asso" as Value },
      { suit: "denara" as Suit, value: "tre" as Value },
      { suit: "denara" as Suit, value: "due" as Value },
      { suit: "denara" as Suit, value: "asso" as Value },
      { suit: "coppe" as Suit, value: "quattro" as Value },
      { suit: "bastoni" as Suit, value: "cinque" as Value },
      { suit: "coppe" as Suit, value: "sei" as Value },
      { suit: "bastoni" as Suit, value: "sette" as Value },
    ];
    // Has cricca in spade AND denara
    expect(detectCricca(cards, "spade")).toBe(true);
    expect(detectCricca(cards, "denara")).toBe(true);
    // But not in coppe or bastoni
    expect(detectCricca(cards, "coppe")).toBe(false);
    expect(detectCricca(cards, "bastoni")).toBe(false);
  });
});
