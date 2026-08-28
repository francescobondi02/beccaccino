import { buildPracticeMatch } from "../../src/services/practiceArchive";

const SUITS = ["denara", "coppe", "spade", "bastoni"];
const VALUES = [
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

/** Seat n is dealt the ten cards of suit n, so hands are easy to assert. */
function dealOf(seat: number): { suit: string; value: string }[] {
  return VALUES.map((value) => ({ suit: SUITS[seat], value }));
}

const PLAYER_IDS = [10, 11, 12, 13];

function practiceRoom(
  overrides: {
    autoPlayedBySeat?: number;
    briscolaAutoChosen?: boolean | null;
    callerSeat?: number;
    provenanceKnown?: boolean;
  } = {},
) {
  const deals = [0, 1, 2, 3].map(dealOf);
  const callerSeat = overrides.callerSeat ?? 2;
  const playOrder = [0, 1, 2, 3].map((offset) => (callerSeat + offset) % 4);
  return {
    isPractice: true,
    started: true,
    finished: true,
    createdAt: new Date("2026-08-26T10:00:00.000Z"),
    lastActivityAt: new Date("2026-08-26T10:30:00.000Z"),
    players: PLAYER_IDS.map((id, seat) => ({
      id,
      seat,
      botModel: seat === 0 ? null : "medio",
    })),
    rounds: [
      {
        number: 1,
        briscola: "coppe",
        briscolaAutoChosen:
          overrides.provenanceKnown === false
            ? null
            : overrides.briscolaAutoChosen ?? false,
        cricca: false,
        hands: [
          {
            number: 1,
            starterId: PLAYER_IDS[callerSeat],
            winnerId: PLAYER_IDS[0],
            cards: playOrder.map((seat, position) => ({
              playerId: PLAYER_IDS[seat],
              suit: deals[seat][0].suit,
              value: deals[seat][0].value,
              position,
              signal: position === 0 ? "busso" : null,
              autoPlayed:
                overrides.provenanceKnown === false
                  ? null
                  : seat === overrides.autoPlayedBySeat,
            })),
          },
        ],
        // Everything not played is still in hand.
        playerCards: [0, 1, 2, 3].flatMap((seat) =>
          deals[seat].slice(1).map((card) => ({
            playerId: PLAYER_IDS[seat],
            ...card,
          })),
        ),
      },
    ],
  };
}

describe("practice match snapshots", () => {
  it("keeps the full replay but lists only genuine human actions", () => {
    const match = buildPracticeMatch(practiceRoom());

    expect(match).not.toBeNull();
    expect(match).toMatchObject({
      humanSeat: 0,
      botTier: "medio",
      completed: true,
      startedAt: new Date("2026-08-26T10:00:00.000Z"),
      endedAt: new Date("2026-08-26T10:30:00.000Z"),
    });

    const round = match!.payload.rounds[0];
    expect(round.callerSeat).toBe(2);
    expect(round.tricks[0].signal).toBe("busso");
    expect(round.tricks[0].winnerSeat).toBe(0);
    expect(round.tricks[0].cards).toEqual([
      [2, "spade:asso"],
      [3, "bastoni:asso"],
      [0, "denara:asso"],
      [1, "coppe:asso"],
    ]);
    expect(round.humanActions).toEqual([
      {
        kind: "play_card",
        trick: 1,
        position: 2,
        card: "denara:asso",
        signal: null,
      },
    ]);
    // Played plus still-held reconstructs the full deal of ten.
    for (const seat of [0, 1, 2, 3]) {
      expect(round.dealtHands[String(seat)]).toHaveLength(10);
      expect(round.dealtHands[String(seat)]).toContain(`${SUITS[seat]}:asso`);
    }
  });

  it("records a human briscola choice and leading signal", () => {
    const match = buildPracticeMatch(practiceRoom({ callerSeat: 0 }));

    expect(match!.payload.rounds[0].humanActions).toEqual([
      { kind: "choose_briscola", suit: "coppe" },
      {
        kind: "play_card",
        trick: 1,
        position: 0,
        card: "denara:asso",
        signal: "busso",
      },
    ]);
  });

  it("keeps a later round dealt before briscola", () => {
    const room = practiceRoom();
    const nextRound = {
      ...room.rounds[0],
      number: 2,
      briscola: null,
      briscolaAutoChosen: null,
      hands: [],
      playerCards: [0, 1, 2, 3].flatMap((seat) =>
        dealOf(seat).map((card) => ({
          playerId: PLAYER_IDS[seat],
          ...card,
        })),
      ),
    };

    const match = buildPracticeMatch({
      ...room,
      rounds: [room.rounds[0], nextRound],
    });

    expect(match!.payload.rounds).toHaveLength(2);
    expect(match!.payload.rounds[1]).toMatchObject({
      number: 2,
      briscola: null,
      callerSeat: 3,
      tricks: [],
      humanActions: [],
    });
    expect(match!.payload.rounds[1].dealtHands["0"]).toHaveLength(10);
  });

  it("rejects a malformed round instead of omitting it", () => {
    const room = practiceRoom();
    const malformedRound = {
      ...room.rounds[0],
      number: 2,
      briscola: null,
      briscolaAutoChosen: null,
      hands: [],
      playerCards: [0, 1, 2, 3]
        .flatMap((seat) =>
          dealOf(seat).map((card) => ({
            playerId: PLAYER_IDS[seat],
            ...card,
          })),
        )
        .slice(1),
    };

    expect(() =>
      buildPracticeMatch({
        ...room,
        rounds: [room.rounds[0], malformedRound],
      }),
    ).toThrow(/round 2.*seat 0.*expected 10/i);
  });

  it("validates the completed payload with the shared parser", () => {
    const room = practiceRoom();
    room.rounds[0].briscola = "invalid";

    expect(() => buildPracticeMatch(room)).toThrow(/briscola is invalid/i);
  });

  it("does not archive a game with only automatic human choices", () => {
    expect(
      buildPracticeMatch(
        practiceRoom({
          callerSeat: 0,
          briscolaAutoChosen: true,
          autoPlayedBySeat: 0,
        }),
      ),
    ).toBeNull();
  });

  it("does not treat unknown provenance as a human choice", () => {
    const room = practiceRoom({
      callerSeat: 0,
      provenanceKnown: false,
    });

    expect(buildPracticeMatch(room)).toBeNull();
  });

  it("skips rooms with nothing to learn from", () => {
    expect(buildPracticeMatch({ ...practiceRoom(), isPractice: false })).toBeNull();
    expect(buildPracticeMatch({ ...practiceRoom(), started: false })).toBeNull();

    const room = practiceRoom();
    const preBriscolaRound = {
      ...room.rounds[0],
      briscola: null,
      briscolaAutoChosen: null,
      hands: [],
      playerCards: [0, 1, 2, 3].flatMap((seat) =>
        dealOf(seat).map((card) => ({
          playerId: PLAYER_IDS[seat],
          ...card,
        })),
      ),
    };
    expect(
      buildPracticeMatch({
        ...room,
        rounds: [preBriscolaRound],
      }),
    ).toBeNull();
  });
});
