import {
  parsePracticeMatchPayload,
  PRACTICE_MATCH_PAYLOAD_VERSION,
  PracticeMatchPayload,
} from "../../src/practice/matchPayload";

const hand = [
  "denara:asso",
  "denara:due",
  "denara:tre",
  "denara:quattro",
  "denara:cinque",
  "denara:sei",
  "denara:sette",
  "denara:fante",
  "denara:cavallo",
  "denara:re",
] as const;

const payload: PracticeMatchPayload = {
  winPoints: 5,
  rounds: [
    {
      number: 1,
      briscola: "coppe",
      callerSeat: 0,
      cricca: false,
      dealtHands: {
        "0": [...hand],
        "1": [...hand],
        "2": [...hand],
        "3": [...hand],
      },
      tricks: [
        {
          number: 1,
          starterSeat: 0,
          winnerSeat: 1,
          signal: "busso",
          cards: [
            [0, "denara:asso"],
            [1, "denara:due"],
          ],
        },
      ],
      humanActions: [
        { kind: "choose_briscola", suit: "coppe" },
        {
          kind: "play_card",
          trick: 1,
          position: 0,
          card: "denara:asso",
          signal: "busso",
        },
      ],
    },
  ],
};

describe("practice match payload", () => {
  it("keeps one shared schema version", () => {
    expect(PRACTICE_MATCH_PAYLOAD_VERSION).toBe(1);
  });

  it("parses the persisted payload contract", () => {
    expect(parsePracticeMatchPayload(payload)).toEqual(payload);
  });

  it("rejects invalid cards and shape drift", () => {
    expect(() =>
      parsePracticeMatchPayload({
        ...payload,
        rounds: [
          {
            ...payload.rounds[0],
            humanActions: [
              {
                kind: "play_card",
                trick: 1,
                position: 0,
                card: "invalid",
                signal: null,
              },
            ],
          },
        ],
      }),
    ).toThrow(/valid suit:value/);
    expect(() =>
      parsePracticeMatchPayload({ ...payload, unexpected: true }),
    ).toThrow(/must contain only/);
  });
});
