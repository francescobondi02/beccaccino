import type {
  GameFinishedPayload,
  NewRoundStartedPayload,
} from "@/sockets/events";
import type {
  CompletedTrick,
  GameStateResponse,
  PlayedCardData,
  PlayerCard,
  PlayerControl,
  RoundEndData,
  RoundDeal,
  TotalPoints,
  TurnTimer,
} from "@/game/model";
import { trickWinner } from "@/game/presentation";

export interface GameTableState {
  gameStatus: GameStateResponse["status"] | null;
  currentRound: GameStateResponse["round"] | null;
  roundDeal: RoundDeal | null;
  callerUserId: number | null;
  myCards: PlayerCard[];
  currentTurnUserId: number | null;
  playedCards: PlayedCardData[];
  playableCards: PlayerCard[];
  completedTricks: CompletedTrick[];
  animatedCard: PlayedCardData | null;
  lastHand: PlayedCardData[];
  currentHandNumber: number | null;
  totalPoints: TotalPoints;
  turnTimer: TurnTimer | null;
  isPractice: boolean;
  playerControls: PlayerControl[];
  roundEndData: RoundEndData | null;
  gameFinishedData: GameFinishedPayload | null;
}

export type GameTableAction =
  | { type: "state_fetched"; data: GameStateResponse; now: number }
  | { type: "playable_cards_fetched"; cards: PlayerCard[] }
  | { type: "card_played"; data: PlayedCardData; myUserId: number | null }
  | { type: "briscola_chosen"; briscola: string }
  | { type: "new_round_started"; data: NewRoundStartedPayload }
  | { type: "game_finished"; data: GameFinishedPayload }
  | { type: "turn_timer_started"; timer: TurnTimer }
  | { type: "completed_trick_released" }
  | { type: "player_control_changed"; player: PlayerControl };

const EMPTY_POINTS: TotalPoints = {
  team0Points: 0,
  team1Points: 0,
  team0Figures: 0,
  team1Figures: 0,
};

export const initialGameTableState: GameTableState = {
  gameStatus: null,
  currentRound: null,
  roundDeal: null,
  callerUserId: null,
  myCards: [],
  currentTurnUserId: null,
  playedCards: [],
  playableCards: [],
  completedTricks: [],
  animatedCard: null,
  lastHand: [],
  currentHandNumber: null,
  totalPoints: EMPTY_POINTS,
  turnTimer: null,
  isPractice: false,
  playerControls: [],
  roundEndData: null,
  gameFinishedData: null,
};

export function gameTableReducer(
  state: GameTableState,
  action: GameTableAction,
): GameTableState {
  switch (action.type) {
    case "player_control_changed":
      return {
        ...state,
        playerControls: [
          ...state.playerControls.filter((player) => player.userId !== action.player.userId),
          action.player,
        ],
        playableCards: [],
      };
    case "state_fetched": {
      const { data, now } = action;
      return {
        ...state,
        gameStatus: data.status,
        currentRound: data.round,
        roundDeal: data.round.deal && data.round.deal.remainingMs > 0
          ? {
              readyAt: now + data.round.deal.remainingMs,
              animationMs: data.round.deal.animationMs,
              reviewMs: data.round.deal.reviewMs,
            }
          : null,
        callerUserId: data.callerUserId,
        myCards: data.myCards ?? [],
        currentTurnUserId: data.currentTurnUserId ?? null,
        playedCards: data.playedCards ?? [],
        playableCards: [],
        lastHand: data.lastHandCards ?? [],
        currentHandNumber: data.currentHandNumber ?? null,
        totalPoints: data.totalPoints ?? EMPTY_POINTS,
        gameFinishedData: data.finishedGame ?? null,
        roundEndData: data.roundSummary ?? null,
        isPractice: data.isPractice ?? false,
        playerControls: data.playerControls ?? [],
        turnTimer: data.turnTimer
          ? {
              turnUserId: data.turnTimer.turnUserId,
              totalMs: data.turnTimer.totalMs,
              // Rebuild the client start time from authoritative remaining time.
              startedAt:
                data.turnTimer.totalMs === null
                  ? now
                  : now - (data.turnTimer.totalMs - data.turnTimer.remainingMs),
              phase: data.turnTimer.phase,
            }
          : null,
      };
    }

    case "playable_cards_fetched":
      if (state.completedTricks.length > 0) return state;
      return { ...state, playableCards: action.cards };

    case "card_played": {
      const { data, myUserId } = action;
      const currentTrick = data.position === 0 ? [] : state.playedCards;
      const playedCards = [...currentTrick, data];
      return {
        ...state,
        // The next timer arrives through turn_timer_started.
        currentTurnUserId: null,
        playableCards: [],
        turnTimer: null,
        myCards:
          data.userId === myUserId
            ? state.myCards.filter(
                (card) =>
                  !(
                    card.suit === data.suit &&
                    card.value === data.value
                  ),
              )
            : state.myCards,
        playedCards,
        animatedCard: data,
        completedTricks:
          playedCards.length === 4
            ? [...state.completedTricks, {
                cards: playedCards,
                roundId: state.currentRound?.id ?? null,
                winnerUserId: trickWinner(playedCards, state.currentRound?.briscola),
              }]
            : state.completedTricks,
      };
    }

    case "briscola_chosen":
      return {
        ...state,
        gameStatus: "playing",
        turnTimer: null,
        currentRound: state.currentRound
          ? { ...state.currentRound, briscola: action.briscola }
          : state.currentRound,
      };

    case "new_round_started":
      return {
        ...state,
        roundDeal: null,
        gameStatus: "choosing_briscola",
        currentRound: {
          id: action.data.roundId,
          number: action.data.roundNumber,
          briscola: null,
          cricca: false,
        },
        callerUserId: action.data.callerUserId,
        myCards: [],
        currentTurnUserId: action.data.callerUserId,
        playedCards: [],
        animatedCard: null,
        playableCards: [],
        currentHandNumber: null,
        turnTimer: null,
        roundEndData: null,
      };

    case "game_finished":
      return {
        ...state,
        gameStatus: "finished",
        gameFinishedData: action.data,
        roundEndData: null,
      };

    case "turn_timer_started":
      return {
        ...state,
        currentTurnUserId: action.timer.turnUserId,
        playableCards: [],
        turnTimer: action.timer,
      };

    case "completed_trick_released": {
      const released = state.completedTricks[0];
      const sameTrick = released &&
        released.roundId === (state.currentRound?.id ?? null) &&
        state.playedCards.length === released.cards.length &&
        state.playedCards.every((card, index) =>
          card.userId === released.cards[index].userId &&
          card.suit === released.cards[index].suit &&
          card.value === released.cards[index].value,
        );
      return {
        ...state,
        completedTricks: state.completedTricks.slice(1),
        playedCards: sameTrick ? [] : state.playedCards,
        playableCards: [],
      };
    }
  }
}
