import type { BotTier, Card, Signal, Suit, Team } from "./cards";

// From raw points: points = raw // 3, figures = raw % 3.
export type TeamScore = { points: number; figures: number };
export type Score = { team0: TeamScore; team1: TeamScore };
export type PlayedCard = Card & { userId: number; signal: Signal | null };
// botModel set: a bot plays this seat.
export type GamePlayer = {
  userId: number;
  username: string;
  isBot: boolean;
  seat: number;
  team: Team;
  botModel: BotTier | null;
  abandoned: boolean;
};
export type TurnPhase = "choose_briscola" | "play_card";
export type ActionSource = "human" | "timeout" | "bot" | "bot_fallback";

export type LastAction =
  | { kind: "game_started" }
  | { kind: "briscola_chosen"; userId: number; suit: Suit; source: ActionSource; takeover: boolean }
  | {
      kind: "card_played";
      userId: number;
      card: Card;
      signal: Signal | null;
      source: ActionSource;
      // This timeout was the third in a row and a bot now plays the seat.
      takeover: boolean;
    }
  | { kind: "control_changed"; userId: number; botModel: BotTier | null }
  | { kind: "paused" }
  | { kind: "resumed" }
  | { kind: "abandoned"; userId: number };

export type GameResult = {
  winnerTeam: Team;
  totalRounds: number;
  finalScores: { team0: number; team1: number };
  roundsWon: { team0: number; team1: number };
  statistics: {
    players: {
      username: string;
      team: Team;
      tricksWon: number;
      busso: number;
      acesCaptured: number;
      acesLost: number;
    }[];
    rounds: { number: number; winnerTeam: Team; score: Score }[];
  };
};

export type LastTrick = {
  roundNumber: number;
  trickNumber: number;
  winnerUserId: number;
  cards: PlayedCard[];
  onTableUntil: string;
};

export type RoundSummary = { roundNumber: number; score: Score; winnerTeam: Team; visibleUntil: string };

// Times are ISO strings.
export type GameState = {
  roomCode: string;
  // Grows by one with every change; clients drop older states.
  version: number;
  // Lets clients correct clock skew.
  serverTime: string;
  status: "choosing_briscola" | "playing" | "paused" | "finished";
  isPractice: boolean;
  // Seat order.
  players: GamePlayer[];
  round: {
    number: number;
    callerUserId: number;
    briscola: Suit | null;
    cricca: boolean;
    deal: { animationEndsAt: string; reviewEndsAt: string } | null;
  };
  trick: { number: number; cards: PlayedCard[] } | null;
  // Shown on the table until onTableUntil, then in "Ultima presa".
  lastTrick: LastTrick | null;
  myHand: Card[];
  // Empty when it is not my turn.
  playableCards: Card[];
  // Null when paused or finished; deadline is null for bots.
  turn: { userId: number; phase: TurnPhase; startedAt: string; deadline: string | null } | null;
  // Cumulative.
  score: Score;
  roundSummary: RoundSummary | null;
  // Set when the game finished with a winner.
  result: GameResult | null;
  // Set in pushes and mutation responses; null from GET /state.
  lastAction: LastAction | null;
};
