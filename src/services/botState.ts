// src/services/botState.ts
/**
 * Serialize a game into the wire format the Python bot service consumes.
 *
 * The contract lives in `ai/serving/state_adapter.py` (`game_to_state_dict` is
 * the canonical producer, and `ai/serving/fixtures/bot_states.json` pins real
 * examples). Two rules matter:
 *
 *  1. Suits and values cross as ENUM STRINGS, never indices. Python orders suits
 *     DENARA, SPADE, COPPE, BASTONI and Prisma orders them denara, coppe, spade,
 *     bastoni — any index computed here would silently transpose 20 cards.
 *  2. Cumulative scores cross as RAW points. We store real points and a figures
 *     remainder in separate columns, so raw = points * 3 + figures. Summing only
 *     the points columns drops each round's remainder.
 *
 * All four hands are included because the Python encoder rebuilds a full game
 * before taking the acting seat's view. It reads only `player_hands[seat]`, and
 * PIMC samples opponents from the unseen pool, so no agent sees the hidden
 * hands — but this is why the service must stay internal.
 */

import { prisma } from "../db";
import {
  resolveCaller,
  resolveTurnSeat,
  seatAfter,
} from "../domain/game/turnOrder";
import { GAME_WIN_POINTS } from "../gameConfig";

/** Real points per raw point — the divisor behind the points/figures split. */
const RAW_PER_POINT = 3;

const SEATS = [0, 1, 2, 3];
const TRICK_SIZE = 4;

type CardDto = { suit: string; value: string };
type SeatedCardDto = CardDto & { seat: number };

export interface BotState {
  phase: "choose_briscola" | "play_card";
  briscola: string | null;
  cricca: boolean;
  round_number: number;
  caller_seat: number;
  trick_starter: number;
  acting_seat: number;
  hands: Record<string, CardDto[]>;
  completed_tricks: {
    cards: SeatedCardDto[];
    signal: string | null;
    signal_seat: number | null;
  }[];
  current_trick: SeatedCardDto[];
  current_signal: string | null;
  total_scores: Record<string, number>;
  win_points: number;
}

export interface BotTurn {
  state: BotState;
  seat: number;
  turnSeat: number | null;
  /** setBriscola is keyed on playerId, unlike playCard which takes userId. */
  playerId: number;
  gameRoomId: number;
}

export class BotStateError extends Error {}

/**
 * Build the state the bot at `userId` needs to choose its move.
 *
 * Kept separate from `getGameState` rather than extracted out of it: the two
 * consumers need genuinely different payloads (a bot needs every hand and raw
 * cumulative scores; a browser needs only its own cards and display points), and
 * refactoring the endpoint every live game depends on buys nothing here.
 */
export async function buildBotTurn(
  roomCode: string,
  userId: number,
): Promise<BotTurn> {
  const room = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: {
      players: true,
      rounds: {
        orderBy: { number: "desc" },
        take: 1,
        include: {
          hands: {
            orderBy: { number: "asc" },
            include: { cards: { orderBy: { position: "asc" } } },
          },
        },
      },
    },
  });

  if (!room) throw new BotStateError(`room ${roomCode} not found`);
  if (room.finished) throw new BotStateError(`game ${roomCode} is finished`);

  const player = room.players.find((p) => p.userId === userId);
  if (!player || player.seat === null) {
    throw new BotStateError(`user ${userId} is not seated in room ${roomCode}`);
  }

  const round = room.rounds[0];
  if (!round) throw new BotStateError(`room ${roomCode} has no round in progress`);

  const seatOf = new Map(room.players.map((p) => [p.id, p.seat!]));
  const requireSeat = (playerId: number): number => {
    const seat = seatOf.get(playerId);
    if (seat === undefined) {
      throw new BotStateError(`player ${playerId} has no seat in room ${roomCode}`);
    }
    return seat;
  };

  // Tricks in play order. The in-progress one is the only hand without a winner;
  // a completed round leaves all ten resolved.
  const tricks = round.hands;
  const openTrick = tricks.find((h) => h.winnerId === null);
  const completedTricks = tricks.filter((h) => h.winnerId !== null);

  const heldCards = await prisma.playerCard.findMany({
    where: { roundId: round.id },
    orderBy: [{ suit: "asc" }, { value: "asc" }],
  });

  const hands: Record<string, CardDto[]> = {};
  for (const seat of SEATS) hands[String(seat)] = [];
  for (const card of heldCards) {
    hands[String(requireSeat(card.playerId))].push({
      suit: card.suit,
      value: card.value,
    });
  }

  let previousCallerSeat: number | null = null;
  if (tricks.length === 0 && round.number > 1) {
    const previousRound = await prisma.round.findFirst({
      where: { gameRoomId: room.id, number: round.number - 1 },
      select: {
        hands: {
          orderBy: { number: "asc" },
          take: 1,
          select: { starterId: true },
        },
      },
    });
    const previousCallerId = previousRound?.hands[0]?.starterId;
    previousCallerSeat =
      previousCallerId === undefined ? null : requireSeat(previousCallerId);
  }
  const quattroDenara = heldCards.find(
    (card) => card.suit === "denara" && card.value === "quattro",
  );
  const callerSeat = resolveCaller({
    roundNumber: round.number,
    firstTrickStarter:
      tricks.length > 0 ? requireSeat(tricks[0].starterId) : null,
    quattroDenaraHolder: quattroDenara
      ? requireSeat(quattroDenara.playerId)
      : null,
    previousCaller: previousCallerSeat,
    nextCaller: (caller) => seatAfter(caller),
  });
  if (callerSeat === null) {
    throw new BotStateError(`room ${roomCode} has no briscola caller`);
  }

  const turnSeat = resolveTurnSeat({
    briscolaChosen: round.briscola !== null,
    callerSeat,
    hand: openTrick
      ? {
          starterSeat: requireSeat(openTrick.starterId),
          playedCardCount: openTrick.cards.length,
          winnerSeat:
            openTrick.winnerId === null
              ? null
              : requireSeat(openTrick.winnerId),
        }
      : null,
  });
  const currentTrick = (openTrick?.cards ?? []).map((c) => ({
    seat: requireSeat(c.playerId),
    suit: c.suit,
    value: c.value,
  }));
  if (currentTrick.length >= TRICK_SIZE) {
    throw new BotStateError(
      `trick ${openTrick!.number} in ${roomCode} is full but unresolved`,
    );
  }

  const state: BotState = {
    phase: round.briscola === null ? "choose_briscola" : "play_card",
    briscola: round.briscola,
    cricca: round.cricca,
    round_number: round.number,
    caller_seat: callerSeat,
    // Before briscola is chosen nobody has led yet; the Python engine seeds
    // trick_starter with the caller in that phase, so mirror it.
    trick_starter: openTrick ? requireSeat(openTrick.starterId) : callerSeat,
    acting_seat: player.seat,
    hands,
    completed_tricks: completedTricks.map((trick) => {
      const leader = trick.cards.find((c) => c.position === 0);
      return {
        cards: trick.cards.map((c) => ({
          seat: requireSeat(c.playerId),
          suit: c.suit,
          value: c.value,
        })),
        signal: leader?.signal ?? null,
        signal_seat: leader ? requireSeat(leader.playerId) : null,
      };
    }),
    current_trick: currentTrick,
    current_signal: openTrick?.cards.find((c) => c.position === 0)?.signal ?? null,
    total_scores: await cumulativeRawScores(room.id),
    win_points: GAME_WIN_POINTS,
  };

  return {
    state,
    seat: player.seat,
    turnSeat,
    playerId: player.id,
    gameRoomId: room.id,
  };
}

/** Cumulative raw points per team over finished rounds, current round excluded. */
async function cumulativeRawScores(
  gameRoomId: number,
): Promise<Record<string, number>> {
  const rounds = await prisma.round.findMany({
    where: { gameRoomId, winnerTeam: { not: null } },
    select: {
      team0Points: true,
      team1Points: true,
      team0Figures: true,
      team1Figures: true,
    },
  });

  return rounds.reduce(
    (total, r) => ({
      "0": total["0"] + r.team0Points * RAW_PER_POINT + r.team0Figures,
      "1": total["1"] + r.team1Points * RAW_PER_POINT + r.team1Figures,
    }),
    { "0": 0, "1": 0 },
  );
}
