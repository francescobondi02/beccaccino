import {
  isLegalCard,
  selectLegalCards,
} from "../../src/domain/game/legalCards";
import {
  resolveCaller,
  resolveTurnSeat,
  seatAfter,
} from "../../src/domain/game/turnOrder";

describe("shared game rules", () => {
  it.each([
    {
      name: "persisted first trick",
      input: {
        roundNumber: 3,
        firstTrickStarter: 2,
        quattroDenaraHolder: 1,
        previousCaller: 0,
      },
      expected: 2,
    },
    {
      name: "first-round quattro di denara",
      input: {
        roundNumber: 1,
        firstTrickStarter: null,
        quattroDenaraHolder: 3,
        previousCaller: null,
      },
      expected: 3,
    },
    {
      name: "clockwise rotation",
      input: {
        roundNumber: 2,
        firstTrickStarter: null,
        quattroDenaraHolder: null,
        previousCaller: 3,
      },
      expected: 0,
    },
  ])("resolves the caller from $name", ({ input, expected }) => {
    expect(
      resolveCaller({
        ...input,
        nextCaller: (caller) => seatAfter(caller),
      }),
    ).toBe(expected);
  });

  it.each([
    {
      name: "briscola choice",
      input: { briscolaChosen: false, callerSeat: 2, hand: null },
      expected: 2,
    },
    {
      name: "first card",
      input: {
        briscolaChosen: true,
        callerSeat: 2,
        hand: { starterSeat: 2, playedCardCount: 0, winnerSeat: null },
      },
      expected: 2,
    },
    {
      name: "wrapped fourth card",
      input: {
        briscolaChosen: true,
        callerSeat: 2,
        hand: { starterSeat: 2, playedCardCount: 3, winnerSeat: null },
      },
      expected: 1,
    },
    {
      name: "completed trick winner",
      input: {
        briscolaChosen: true,
        callerSeat: 2,
        hand: { starterSeat: 2, playedCardCount: 4, winnerSeat: 3 },
      },
      expected: 3,
    },
  ])("resolves the current turn for $name", ({ input, expected }) => {
    expect(resolveTurnSeat(input)).toBe(expected);
  });

  it.each([
    {
      name: "leader may play every card",
      leadSuit: null,
      expectedIds: [1, 2, 3],
    },
    {
      name: "player must follow suit",
      leadSuit: "coppe",
      expectedIds: [2, 3],
    },
    {
      name: "void player may play every card",
      leadSuit: "bastoni",
      expectedIds: [1, 2, 3],
    },
  ])("selects legal cards when $name", ({ leadSuit, expectedIds }) => {
    const cards = [
      { id: 1, suit: "denara" },
      { id: 2, suit: "coppe" },
      { id: 3, suit: "coppe" },
    ];
    const legal = selectLegalCards(cards, leadSuit);

    expect(legal.map((card) => card.id)).toEqual(expectedIds);
    for (const card of cards) {
      expect(isLegalCard(cards, card, leadSuit)).toBe(
        expectedIds.includes(card.id),
      );
    }
  });
});
