import fs from "fs";
import path from "path";
import { prisma } from "../../src/db";
import { Suit, Value } from "@prisma/client";
import { clearDatabase } from "../helpers/database";
import { buildBotTurn, BotState } from "../../src/services/botState";
import { ensureBotUsers } from "../../src/services/botUsers";
import { GAME_WIN_POINTS } from "../../src/gameConfig";

// Read at runtime rather than importing: the fixture is generated in `ai/`
// (`python -m scripts.gen_bot_fixtures`), and importing across that boundary
// would drag it into the backend's own build.
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../ai/serving/fixtures/bot_states.json",
);

/**
 * Cross-language parity for the bot state serializer (BOT_PLAY_DESIGN.md §5.3b).
 *
 * The Python parity tests only prove Python agrees with itself — nothing there
 * touches this TypeScript serializer. These fixtures close that gap: Python
 * emitted each `state` alongside the observation vector it encodes to, so
 * rebuilding the same board in Postgres and re-serializing it here must
 * reproduce the DTO byte for byte.
 *
 * This matters because the fields most likely to be wrong — cumulative scores in
 * raw units, the full round's trick history, signals, deduced voids — do not
 * change which cards are legal, so the runtime 409 gate cannot catch them. A
 * wrong board would just make the bot play badly, and we would blame the model.
 */
describe("Bot state serializer matches the Python fixtures", () => {
  const cases: {
    name: string;
    description: string;
    seat: number;
    state: BotState;
  }[] = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")).cases;

  beforeEach(async () => {
    await clearDatabase();
  });

  it.each(cases.map((c) => [c.name, c] as const))(
    "reproduces %s",
    async (_name, fixture) => {
      const { roomCode, userId } = await seedFromFixture(fixture.state, fixture.seat);
      const { state, seat } = await buildBotTurn(roomCode, userId);

      expect(seat).toBe(fixture.seat);
      expect(normalize(state)).toEqual(normalize(fixture.state));
      // Asserted separately: the fixtures were generated with the default 41,
      // while the test env sets GAME_WIN_POINTS=5 to keep games short. What
      // matters is that we forward the configured value, not that it matches.
      expect(state.win_points).toBe(GAME_WIN_POINTS);
    },
  );

  it("covers the blocks the runtime legality gate cannot catch", () => {
    // Guards the fixture set itself: if a future regeneration drops these cases,
    // the suite above would still pass while testing much less.
    const withScores = cases.filter((c) => Object.values(c.state.total_scores).some((v) => v > 0));
    const multiTrick = cases.filter((c) => c.state.completed_tricks.length > 1);
    const withSignals = cases.filter((c) =>
      c.state.completed_tricks.some((t) => t.signal !== null),
    );
    const seatsCovered = new Set(cases.map((c) => c.seat));

    expect(withScores.length).toBeGreaterThan(0);
    expect(multiTrick.length).toBeGreaterThan(0);
    expect(withSignals.length).toBeGreaterThan(0);
    expect([...seatsCovered].sort()).toEqual([0, 1, 2, 3]);

    // A remainder-carrying score is the whole point of the scores case: raw
    // points that divide evenly would pass even if figures were dropped.
    const rawScores = withScores.flatMap((c) => Object.values(c.state.total_scores));
    expect(rawScores.some((raw) => raw % 3 !== 0)).toBe(true);
  });
});

/**
 * Rebuild a fixture board in the database: a practice room seated to match the
 * fixture's seats, one round, and each trick replayed as Trick + PlayedCard rows.
 */
async function seedFromFixture(state: BotState, actingSeat: number) {
  const botUserIds = await ensureBotUsers();
  const human = await prisma.user.create({
    data: { username: `human-${actingSeat}-${Date.now()}` },
  });

  // The acting seat is the one we serialize from, so it must be the bot whose
  // turn it is; the remaining seats' identities are irrelevant to the DTO.
  const botUserBySeat = new Map(
    [0, 1, 2, 3]
      .filter((seat) => seat !== actingSeat)
      .map((seat, index) => [seat, botUserIds[index]]),
  );
  const userIdForSeat = (seat: number) =>
    seat === actingSeat ? human.id : botUserBySeat.get(seat)!;

  const room = await prisma.gameRoom.create({
    data: {
      code: `F${actingSeat}${Date.now() % 100000}`,
      started: true,
      isPractice: true,
      players: {
        create: [0, 1, 2, 3].map((seat) => ({
          userId: userIdForSeat(seat),
          seat,
          team: seat % 2,
          isReady: true,
        })),
      },
    },
    include: { players: true },
  });

  const playerIdOf = new Map(room.players.map((p) => [p.seat!, p.id]));
  const round = await prisma.round.create({
    data: {
      number: state.round_number,
      briscola: state.briscola as Suit | null,
      cricca: state.cricca,
      gameRoomId: room.id,
      callerId: playerIdOf.get(state.caller_seat)!,
    },
  });

  for (const [seat, cards] of Object.entries(state.hands)) {
    await prisma.handCard.createMany({
      data: cards.map((c) => ({
        playerId: playerIdOf.get(Number(seat))!,
        roundId: round.id,
        suit: c.suit as Suit,
        value: c.value as Value,
      })),
    });
  }

  let trickNumber = 1;
  for (const trick of state.completed_tricks) {
    const leadSeat = trick.cards[0].seat;
    const trickRow = await prisma.trick.create({
      data: {
        roundId: round.id,
        number: trickNumber++,
        starterId: playerIdOf.get(leadSeat)!,
        // Any non-null winner marks the trick resolved; the serializer only
        // reads the flag, and Python recomputes the true winner from the cards.
        winnerId: playerIdOf.get(leadSeat)!,
      },
    });
    await prisma.playedCard.createMany({
      data: trick.cards.map((c, position) => ({
        trickId: trickRow.id,
        playerId: playerIdOf.get(c.seat)!,
        suit: c.suit as Suit,
        value: c.value as Value,
        position,
        signal: position === 0 ? trick.signal : null,
      })),
    });
  }

  // The open trick exists once briscola is set — even with no cards played yet,
  // since setBriscola creates trick 1 for the caller to lead into.
  if (state.phase === "play_card") {
    const trickRow = await prisma.trick.create({
      data: {
        roundId: round.id,
        number: trickNumber,
        starterId: playerIdOf.get(state.trick_starter)!,
      },
    });
    await prisma.playedCard.createMany({
      data: state.current_trick.map((c, position) => ({
        trickId: trickRow.id,
        playerId: playerIdOf.get(c.seat)!,
        suit: c.suit as Suit,
        value: c.value as Value,
        position,
        signal: position === 0 ? state.current_signal : null,
      })),
    });
  }

  // Scores cross the wire as cumulative raw points from finished rounds, so
  // express the fixture's totals as a prior completed round.
  const raw = state.total_scores;
  if (raw["0"] > 0 || raw["1"] > 0) {
    await prisma.round.create({
      data: {
        number: 0,
        gameRoomId: room.id,
        callerId: playerIdOf.get(state.caller_seat)!,
        briscola: Suit.denara,
        winnerTeam: raw["0"] >= raw["1"] ? 0 : 1,
        team0Raw: raw["0"],
        team1Raw: raw["1"],
      },
    });
  }

  return { roomCode: room.code, userId: userIdForSeat(actingSeat) };
}

/**
 * Sort each seat's hand before comparing. The fixture preserves Python's dealt
 * order while Prisma returns rows sorted, and the encoder is order-insensitive
 * for hands (verified) — unlike trick order, which stays compared as-is.
 */
function normalize(state: BotState): Omit<BotState, "win_points"> {
  const key = (c: { suit: string; value: string }) => `${c.suit}:${c.value}`;
  const { win_points: _ignored, ...rest } = state;
  return {
    ...rest,
    hands: Object.fromEntries(
      Object.entries(state.hands).map(([seat, cards]) => [
        seat,
        [...cards].sort((a, b) => key(a).localeCompare(key(b))),
      ]),
    ),
  };
}
