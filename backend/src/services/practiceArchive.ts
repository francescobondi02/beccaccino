// src/services/practiceArchive.ts
/**
 * Snapshot a practice game into one `PracticeMatch` row before its live rows are
 * deleted.
 *
 * Practice games are torn down the moment the human leaves the table
 * (`leaveRoom`) or when the sweeper finds them finished or stale, so
 * `retirePracticeRoom` is the single place every practice game passes through on
 * its way out — that is why the snapshot hangs off it instead of off the end of
 * the game, which would miss abandoned games.
 *
 * The payload keeps a game replayable offline: the cards each seat was dealt
 * plus every play in order is enough to rebuild any position in the game,
 * including what the human could see when they decided. Nothing derived is
 * stored (no cumulative scores, no trick winners' points) — deriving beats
 * duplicating a rule that lives in the engine.
 */

import { Prisma } from "@prisma/client";
import {
  resolveCaller,
  seatAfter,
} from "../domain/game/turnOrder";
import { CardSignal, Suit } from "../domain/game/cards";
import { GAME_WIN_POINTS } from "../gameConfig";
import {
  parsePracticeMatchPayload,
  PRACTICE_MATCH_PAYLOAD_VERSION,
  PracticeCardCode,
  PracticeCardEntry,
  PracticeHumanAction,
  PracticeMatchPayload,
  PracticeRoundPayload,
  PracticeSeat,
} from "../practice/matchPayload";

const SEATS = [0, 1, 2, 3] as const;

/** Only what the snapshot reads, so the builder stays a pure function. */
type ArchivableRoom = {
  isPractice: boolean;
  started: boolean;
  finished: boolean;
  createdAt: Date;
  lastActivityAt: Date;
  players: {
    id: number;
    seat: number | null;
    botModel: string | null;
  }[];
  rounds: {
    number: number;
    briscola: string | null;
    briscolaAutoChosen: boolean | null;
    cricca: boolean;
    hands: {
      number: number;
      starterId: number;
      winnerId: number | null;
      cards: {
        playerId: number;
        suit: string;
        value: string;
        position: number;
        signal: string | null;
        autoPlayed: boolean | null;
      }[];
    }[];
    playerCards: { playerId: number; suit: string; value: string }[];
  }[];
};

export type PracticeMatchRecord = {
  humanSeat: PracticeSeat;
  botTier: string;
  completed: boolean;
  startedAt: Date;
  endedAt: Date;
  payload: PracticeMatchPayload;
};

function cardCode(card: { suit: string; value: string }): PracticeCardCode {
  return `${card.suit}:${card.value}` as PracticeCardCode;
}

/**
 * Build the snapshot, or null when there is intentionally nothing to archive:
 * a non-practice room or a game with no genuine human action.
 */
export function buildPracticeMatch(
  room: ArchivableRoom,
): PracticeMatchRecord | null {
  if (!room.isPractice) return null;
  if (!room.started) return null;

  const humans = room.players.filter((player) => player.botModel === null);
  const bots = room.players.filter((player) => player.botModel !== null);
  if (humans.length !== 1 || bots.length !== 3) {
    throw new Error("Practice snapshot must contain one human and three bots");
  }
  if (
    room.players.some(
      (player) =>
        player.seat === null ||
        !SEATS.includes(player.seat as PracticeSeat),
    ) ||
    new Set(room.players.map((player) => player.seat)).size !== SEATS.length
  ) {
    throw new Error("Practice snapshot must contain seats 0 through 3");
  }

  const human = humans[0];
  const botTier = bots[0].botModel!;
  if (!botTier || bots.some((bot) => bot.botModel !== botTier)) {
    throw new Error("Practice snapshot bots must use one tier");
  }
  const seatOf = new Map(
    room.players.map((player) => [player.id, player.seat as PracticeSeat]),
  );
  const rounds: PracticeRoundPayload[] = [];
  for (const round of room.rounds) {
    rounds.push(
      buildRound(
        round,
        seatOf,
        human.seat as PracticeSeat,
        rounds[rounds.length - 1]?.callerSeat,
      ),
    );
  }
  if (rounds.length === 0) return null;

  const payload = parsePracticeMatchPayload({
    winPoints: GAME_WIN_POINTS,
    rounds,
  });
  if (!payload.rounds.some((round) => round.humanActions.length > 0)) {
    return null;
  }

  return {
    humanSeat: human.seat as PracticeSeat,
    botTier,
    completed: room.finished,
    startedAt: room.createdAt,
    endedAt: room.lastActivityAt,
    payload,
  };
}

function buildRound(
  round: ArchivableRoom["rounds"][number],
  seatOf: Map<number, PracticeSeat>,
  humanSeat: PracticeSeat,
  previousCallerSeat: PracticeSeat | undefined,
): PracticeRoundPayload {
  const seat = (playerId: number): PracticeSeat => {
    const playerSeat = seatOf.get(playerId);
    if (playerSeat === undefined) {
      throw new Error(
        `Practice round ${round.number} references unknown player ${playerId}`,
      );
    }
    return playerSeat;
  };
  const tricks = round.hands.filter((hand) => hand.cards.length > 0);

  const dealtHands: Record<string, PracticeCardCode[]> = {};
  for (const seatNumber of SEATS) dealtHands[String(seatNumber)] = [];
  for (const trick of tricks) {
    for (const card of trick.cards) {
      dealtHands[String(seat(card.playerId))].push(cardCode(card));
    }
  }
  // Cards still in hand: a play deletes its PlayerCard row, so whatever is left
  // was never played — the only way to complete the deal of an abandoned round.
  for (const card of round.playerCards) {
    dealtHands[String(seat(card.playerId))].push(cardCode(card));
  }
  for (const cards of Object.values(dealtHands)) cards.sort();
  const invalidDeal = Object.entries(dealtHands).find(
    ([, cards]) => cards.length !== 10,
  );
  if (invalidDeal) {
    throw new Error(
      `Practice round ${round.number} seat ${invalidDeal[0]} has ${invalidDeal[1].length} cards; expected 10`,
    );
  }

  const quattro = round.playerCards.find(
    (card) => card.suit === "denara" && card.value === "quattro",
  );
  const callerSeat = resolveCaller({
    roundNumber: round.number,
    firstTrickStarter:
      round.hands.length > 0 ? seat(round.hands[0].starterId) : null,
    quattroDenaraHolder: quattro ? seat(quattro.playerId) : null,
    previousCaller: previousCallerSeat,
    nextCaller: (caller) => seatAfter(caller) as PracticeSeat,
  });
  if (callerSeat === null) {
    throw new Error(`Practice round ${round.number} has no resolvable caller`);
  }

  const humanActions: PracticeHumanAction[] = [];
  if (
    round.briscola !== null &&
    callerSeat === humanSeat &&
    round.briscolaAutoChosen === false
  ) {
    humanActions.push({
      kind: "choose_briscola",
      suit: round.briscola as Suit,
    });
  }
  for (const trick of tricks) {
    for (const card of trick.cards) {
      if (seat(card.playerId) !== humanSeat || card.autoPlayed !== false) {
        continue;
      }
      humanActions.push({
        kind: "play_card",
        trick: trick.number,
        position: card.position,
        card: cardCode(card),
        signal: card.signal as CardSignal | null,
      });
    }
  }

  return {
    number: round.number,
    briscola: round.briscola as Suit | null,
    callerSeat,
    cricca: round.cricca,
    dealtHands,
    tricks: tricks.map((trick) => ({
      number: trick.number,
      starterSeat: seat(trick.starterId),
      winnerSeat: trick.winnerId === null ? null : seat(trick.winnerId),
      signal:
        (trick.cards.find((card) => card.position === 0)?.signal as
          | CardSignal
          | null
          | undefined) ?? null,
      cards: trick.cards.map(
        (card): PracticeCardEntry => [seat(card.playerId), cardCode(card)],
      ),
    })),
    humanActions,
  };
}

/**
 * Archive the practice game in `gameRoomId`, if any. Runs inside the caller's
 * transaction so a failed snapshot rolls the delete back: the game survives and
 * the next sweep retries it, rather than disappearing unnoticed.
 */
export async function archivePracticeMatch(
  tx: Prisma.TransactionClient,
  gameRoomId: number,
): Promise<void> {
  const room = await tx.gameRoom.findUnique({
    where: { id: gameRoomId },
    select: {
      isPractice: true,
      started: true,
      finished: true,
      createdAt: true,
      lastActivityAt: true,
      players: {
        select: { id: true, seat: true, botModel: true },
      },
      rounds: {
        orderBy: { number: "asc" },
        select: {
          number: true,
          briscola: true,
          briscolaAutoChosen: true,
          cricca: true,
          hands: {
            orderBy: { number: "asc" },
            select: {
              number: true,
              starterId: true,
              winnerId: true,
              cards: {
                orderBy: { position: "asc" },
                select: {
                  playerId: true,
                  suit: true,
                  value: true,
                  position: true,
                  signal: true,
                  autoPlayed: true,
                },
              },
            },
          },
          playerCards: { select: { playerId: true, suit: true, value: true } },
        },
      },
    },
  });
  if (!room) return;

  const match = buildPracticeMatch(room);
  if (!match) return;

  await tx.practiceMatch.create({
    data: { ...match, schemaVersion: PRACTICE_MATCH_PAYLOAD_VERSION },
  });
}
