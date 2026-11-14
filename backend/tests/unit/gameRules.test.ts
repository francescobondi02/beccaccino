import {
  isLegalCard,
  selectLegalCards,
} from "../../src/domain/game/legalCards";
import { nextCallerPlayerId, resolveTurnSeat } from "../../src/domain/game/turnOrder";

describe("shared game rules", () => {
  it.each([
    {
      name: "briscola choice",
      input: { briscolaChosen: false, callerSeat: 2, trick: null },
      expected: 2,
    },
    {
      name: "first card",
      input: {
        briscolaChosen: true,
        callerSeat: 2,
        trick: { starterSeat: 2, playedCardCount: 0, winnerSeat: null },
      },
      expected: 2,
    },
    {
      name: "wrapped fourth card",
      input: {
        briscolaChosen: true,
        callerSeat: 2,
        trick: { starterSeat: 2, playedCardCount: 3, winnerSeat: null },
      },
      expected: 1,
    },
    {
      name: "completed trick winner",
      input: {
        briscolaChosen: true,
        callerSeat: 2,
        trick: { starterSeat: 2, playedCardCount: 4, winnerSeat: 3 },
      },
      expected: 3,
    },
  ])("resolves the current turn for $name", ({ input, expected }) => {
    expect(resolveTurnSeat(input)).toBe(expected);
  });

  it.each([
    { previousCallerId: 13, expected: 10 },
    { previousCallerId: 10, expected: 11 },
  ])("passes the call from $previousCallerId to $expected", ({ previousCallerId, expected }) => {
    const players = [
      { id: 12, seat: 2 },
      { id: 10, seat: 0 },
      { id: 13, seat: 3 },
      { id: 11, seat: 1 },
    ];
    expect(nextCallerPlayerId(players, previousCallerId)).toBe(expected);
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
