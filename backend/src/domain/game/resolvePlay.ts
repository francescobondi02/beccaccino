import { GameError } from "../../utils/gameError";
import { GAME_WIN_POINTS } from "../../gameConfig";
import { isLegalCard } from "./legalCards";
import { determineTrickWinner } from "./trickWinner";
import { computeRoundScore, settleRound } from "./roundScore";
import { decideGameWinner, sumRoundScores } from "./gameScore";
import type { LiveGame } from "../../game/liveGame";
import type { Card, Team } from "../../contract/cards";

export type PlayResult = {
  // Set when this card completes the trick.
  trickWinnerId?: number;
  // Set when this card completes the round.
  roundScore?: { team0Raw: number; team1Raw: number; winnerTeam: number };
  // Set with roundScore: the winning team, or null while the game goes on.
  gameWinner?: Team | null;
};

// Checks a card play in the open trick and works out what it completes.
export function resolvePlay(game: LiveGame, playerId: number, card: Card): PlayResult {
  const round = game.round!;
  const trick = game.trick!;
  const hand = game.hands.get(playerId) ?? [];
  const held = hand.find((candidate) => candidate.suit === card.suit && candidate.value === card.value);
  if (!held) throw new GameError("Player does not have this card", 400);
  if (!isLegalCard(hand, held, trick.cards[0]?.suit ?? null)) {
    throw new GameError("Player must follow suit", 400);
  }

  const cards = [...trick.cards, { ...card, playerId }];
  if (cards.length < 4) return {};
  const trickWinnerId = determineTrickWinner(cards, round.briscola);
  if (trick.number < 10) return { trickWinnerId };

  const teams: Record<number, number> = {};
  for (const player of game.players) if (player.team !== null) teams[player.id] = player.team;
  const callerTeam = teams[round.callerId] as Team;
  const roundScore = settleRound(
    computeRoundScore(
      round.tricks.map((candidate) =>
        candidate.id === trick.id
          ? { winnerId: trickWinnerId, cards }
          : { winnerId: candidate.winnerId!, cards: candidate.cards },
      ),
      teams,
    ),
    round.cricca ? callerTeam : null,
  );
  const gameWinner = decideGameWinner(
    sumRoundScores([...game.roundScores, roundScore]),
    GAME_WIN_POINTS,
    callerTeam,
  );
  return { trickWinnerId, roundScore, gameWinner };
}
