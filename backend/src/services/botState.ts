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
 *  2. Cumulative scores cross as RAW points, as stored per round.
 *
 * All four hands are included because the Python encoder rebuilds a full game
 * before taking the acting seat's view. It reads only `player_hands[seat]`, and
 * PIMC samples opponents from the unseen pool, so no agent sees the hidden
 * hands — but this is why the service must stay internal.
 */

import { GAME_WIN_POINTS } from "../gameConfig";
import type { LiveGame, LiveTrick } from "../game/liveGame";

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

// The state the bot at `userId` needs to choose its move.
export function toBotState(game: LiveGame, userId: number): BotState {
  const round = game.round!;
  const seatOf = new Map(game.players.map((player) => [player.id, player.seat!]));
  const seated = (cards: LiveTrick["cards"]) =>
    cards.map((card) => ({ seat: seatOf.get(card.playerId)!, suit: card.suit, value: card.value }));
  const hands: Record<string, CardDto[]> = {};
  for (const player of game.players) hands[String(player.seat)] = game.hands.get(player.id) ?? [];
  const callerSeat = seatOf.get(round.callerId)!;
  const trick = game.trick;
  const raw = game.roundScores.reduce(
    (sum, score) => ({ team0: sum.team0 + score.team0Raw, team1: sum.team1 + score.team1Raw }),
    { team0: 0, team1: 0 },
  );

  return {
    phase: round.briscola === null ? "choose_briscola" : "play_card",
    briscola: round.briscola,
    cricca: round.cricca,
    round_number: round.number,
    caller_seat: callerSeat,
    // Before briscola is chosen nobody has led yet; the Python engine seeds
    // trick_starter with the caller in that phase, so mirror it.
    trick_starter: trick ? seatOf.get(trick.starterId)! : callerSeat,
    acting_seat: game.players.find((player) => player.userId === userId)!.seat!,
    hands,
    completed_tricks: round.tricks
      .filter((candidate) => candidate.winnerId !== null)
      .map((completed) => ({
        cards: seated(completed.cards),
        signal: completed.cards[0]?.signal ?? null,
        signal_seat: completed.cards[0] ? seatOf.get(completed.cards[0].playerId)! : null,
      })),
    current_trick: seated(trick?.cards ?? []),
    current_signal: trick?.cards[0]?.signal ?? null,
    total_scores: { "0": raw.team0, "1": raw.team1 },
    win_points: GAME_WIN_POINTS,
  };
}
