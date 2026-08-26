// src/services/practiceArchive.ts
/**
 * Snapshot a practice game into one `PracticeMatch` row before its live rows are
 * deleted.
 *
 * Practice games are torn down the moment the human leaves the table
 * (`leaveRoomCommand`) or when the sweeper finds them finished or stale, so
 * `deleteRoomAndPlay` is the single place every practice game passes through on
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
import { GAME_WIN_POINTS } from "../gameConfig";

/** Bump when the payload shape or replay rules change. */
const PAYLOAD_VERSION = 1;

const SEATS = [0, 1, 2, 3] as const;

/** `[seat, "suit:value"]`. These cards rebuild context; they are not labels. */
type CardEntry = [number, string];

type HumanAction =
  | {
      kind: "choose_briscola";
      suit: string;
    }
  | {
      kind: "play_card";
      trick: number;
      position: number;
      card: string;
      signal: string | null;
    };

type TrickPayload = {
  number: number;
  starterSeat: number;
  winnerSeat: number | null;
  signal: string | null;
  cards: CardEntry[];
};

type RoundPayload = {
  number: number;
  briscola: string | null;
  callerSeat: number;
  cricca: boolean;
  /** The 10 cards each seat held at the start of the round; order is not meaningful. */
  dealtHands: Record<string, string[]>;
  tricks: TrickPayload[];
  /** The only training labels: choices made directly by the human. */
  humanActions: HumanAction[];
};

type MatchPayload = {
  winPoints: number;
  rounds: RoundPayload[];
};

/** Only what the snapshot reads, so the builder stays a pure function. */
type ArchivableRoom = {
  isPractice: boolean;
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
  humanSeat: number;
  botTier: string;
  completed: boolean;
  startedAt: Date;
  endedAt: Date;
  payload: MatchPayload;
};

function cardCode(card: { suit: string; value: string }): string {
  return `${card.suit}:${card.value}`;
}

/**
 * Build the snapshot, or null when there is nothing worth keeping: a room that
 * is not practice, has no seated human, or died before any briscola was chosen.
 */
export function buildPracticeMatch(
  room: ArchivableRoom,
): PracticeMatchRecord | null {
  if (!room.isPractice) return null;

  const human = room.players.find((player) => player.botModel === null);
  const bot = room.players.find((player) => player.botModel !== null);
  // Every seat is filled before a practice game starts, so an unseated player
  // means a half-built room: nothing we could map onto a board.
  if (!human || !bot?.botModel) return null;
  if (room.players.some((player) => player.seat === null)) return null;

  const seatOf = new Map(room.players.map((player) => [player.id, player.seat!]));
  const rounds: RoundPayload[] = [];
  for (const round of room.rounds) {
    const archived = buildRound(
      round,
      seatOf,
      human.seat!,
      rounds[rounds.length - 1]?.callerSeat,
    );
    if (archived) rounds.push(archived);
  }
  if (!rounds.some((round) => round.humanActions.length > 0)) return null;

  return {
    humanSeat: human.seat!,
    botTier: bot.botModel,
    completed: room.finished,
    startedAt: room.createdAt,
    endedAt: room.lastActivityAt,
    payload: {
      winPoints: GAME_WIN_POINTS,
      rounds,
    },
  };
}

function buildRound(
  round: ArchivableRoom["rounds"][number],
  seatOf: Map<number, number>,
  humanSeat: number,
  previousCallerSeat: number | undefined,
): RoundPayload | null {
  const seat = (playerId: number): number => seatOf.get(playerId)!;
  const tricks = round.hands.filter((hand) => hand.cards.length > 0);

  const dealtHands: Record<string, string[]> = {};
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
  if (Object.values(dealtHands).some((cards) => cards.length !== 10)) {
    return null;
  }

  let callerSeat: number | undefined;
  if (round.hands.length > 0) {
    callerSeat = seat(round.hands[0].starterId);
  } else if (round.number === 1) {
    const quattro = round.playerCards.find(
      (card) => card.suit === "denara" && card.value === "quattro",
    );
    callerSeat = quattro ? seat(quattro.playerId) : undefined;
  } else if (previousCallerSeat !== undefined) {
    callerSeat = (previousCallerSeat + 1) % SEATS.length;
  }
  if (callerSeat === undefined) return null;

  const humanActions: HumanAction[] = [];
  if (
    round.briscola !== null &&
    callerSeat === humanSeat &&
    round.briscolaAutoChosen === false
  ) {
    humanActions.push({
      kind: "choose_briscola",
      suit: round.briscola!,
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
        signal: card.signal,
      });
    }
  }

  return {
    number: round.number,
    briscola: round.briscola,
    callerSeat,
    cricca: round.cricca,
    dealtHands,
    tricks: tricks.map((trick) => ({
      number: trick.number,
      starterSeat: seat(trick.starterId),
      winnerSeat: trick.winnerId === null ? null : seat(trick.winnerId),
      signal: trick.cards.find((card) => card.position === 0)?.signal ?? null,
      cards: trick.cards.map(
        (card): CardEntry => [seat(card.playerId), cardCode(card)],
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
    data: { ...match, schemaVersion: PAYLOAD_VERSION },
  });
}
