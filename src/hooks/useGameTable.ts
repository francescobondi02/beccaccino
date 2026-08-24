import { useCallback, useEffect, useReducer, useRef } from "react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import {
  getSocket,
  onConnectionStatusChange,
  registerErrorToast,
} from "@/sockets/socketClient";
import { registerRoomHandlers } from "@/sockets/roomHandlers";
import type {
  CardPlayedPayload,
  BriscolaChosenPayload,
  RoundEndedPayload,
  GameFinishedPayload,
  TurnTimerStartedPayload,
  AutoPlayedPayload,
  PlayerKickedTimeoutPayload,
  PlayerDisconnectedPayload,
} from "@/sockets/events";
import type { MoveLogEntry } from "@/components/MoveLog";
import type { RevealedHand } from "@/components/PracticePanel";

export interface PlayerCard {
  id: number;
  suit: string;
  value: string;
  playerId: number;
  roundId: number;
  inHand: boolean;
}

export interface PlayedCardData {
  playerId: number;
  userId: number;
  suit: string;
  value: string;
  position: number;
  signal?: string | null;
  handNumber?: number;
}

export interface TotalPoints {
  team0Points: number;
  team1Points: number;
  team0Figures: number;
  team1Figures: number;
}

// totalMs is null for bot turns (no deadline to count down to).
// startedAt is on the CLIENT clock — the server's timestamp lives on a
// different clock, and skew would corrupt the countdown.
export interface TurnTimer {
  turnUserId: number;
  totalMs: number | null;
  startedAt: number;
  phase: string;
}

export interface RoundEndData {
  roundNumber: number;
  team0Points: number;
  team1Points: number;
  team0Figures: number;
  team1Figures: number;
  winnerTeam: number;
}

// Shape of GET /games/:code/state (backend gameController.getGameState).
export interface GameStateResponse {
  round: {
    id: number;
    number: number;
    briscola: string | null;
    cricca?: boolean;
  };
  currentHandNumber: number | null;
  callerUserId: number | null;
  myCards: PlayerCard[];
  currentTurnUserId: number | null;
  playedCards: PlayedCardData[];
  lastHandCards: PlayedCardData[];
  totalPoints: TotalPoints;
  turnTimer: {
    turnUserId: number;
    remainingMs: number;
    totalMs: number;
    phase: string;
  } | null;
  isPractice: boolean;
  allHands: RevealedHand[] | null;
}

export interface GameTableState {
  currentRound: GameStateResponse["round"] | null;
  callerUserId: number | null;
  myCards: PlayerCard[];
  currentTurnUserId: number | null;
  playedCards: PlayedCardData[];
  playableCards: PlayerCard[];
  lastHand: PlayedCardData[];
  currentHandNumber: number | null;
  totalPoints: TotalPoints;
  turnTimer: TurnTimer | null;
  currentSignal: { userId: number; signal: string } | null;
  isPractice: boolean;
  allHands: RevealedHand[] | null;
  moveLog: MoveLogEntry[];
  roundEndData: RoundEndData | null;
  gameFinishedData: GameFinishedPayload | null;
}

export type GameTableAction =
  | { type: "state_fetched"; data: GameStateResponse; now: number }
  | { type: "playable_cards_fetched"; cards: PlayerCard[] }
  | {
      type: "card_played";
      data: PlayedCardData;
      myUserId: number | null;
      username: string;
    }
  | { type: "briscola_chosen"; briscola: string }
  | { type: "round_ended"; data: RoundEndedPayload }
  | { type: "round_end_dismissed" }
  | { type: "game_finished"; data: GameFinishedPayload }
  | { type: "turn_timer_started"; timer: TurnTimer };

const EMPTY_POINTS: TotalPoints = {
  team0Points: 0,
  team1Points: 0,
  team0Figures: 0,
  team1Figures: 0,
};

export const initialGameTableState: GameTableState = {
  currentRound: null,
  callerUserId: null,
  myCards: [],
  currentTurnUserId: null,
  playedCards: [],
  playableCards: [],
  lastHand: [],
  currentHandNumber: null,
  totalPoints: EMPTY_POINTS,
  turnTimer: null,
  currentSignal: null,
  isPractice: false,
  allHands: null,
  moveLog: [],
  roundEndData: null,
  gameFinishedData: null,
};

export function gameTableReducer(
  state: GameTableState,
  action: GameTableAction,
): GameTableState {
  switch (action.type) {
    case "state_fetched": {
      const { data, now } = action;
      return {
        ...state,
        currentRound: data.round,
        callerUserId: data.callerUserId,
        myCards: data.myCards ?? [],
        currentTurnUserId: data.currentTurnUserId ?? null,
        playedCards: data.playedCards ?? [],
        lastHand: data.lastHandCards ?? [],
        currentHandNumber: data.currentHandNumber ?? null,
        totalPoints: data.totalPoints ?? EMPTY_POINTS,
        isPractice: data.isPractice ?? false,
        allHands: data.allHands ?? null,
        turnTimer: data.turnTimer
          ? {
              turnUserId: data.turnTimer.turnUserId,
              totalMs: data.turnTimer.totalMs,
              // Rebuild the local start timestamp from the server's remaining
              // time so reconnecting players resume the countdown mid-flight.
              startedAt:
                now - (data.turnTimer.totalMs - data.turnTimer.remainingMs),
              phase: data.turnTimer.phase,
            }
          : null,
      };
    }

    case "playable_cards_fetched":
      return { ...state, playableCards: action.cards };

    case "card_played": {
      const { data, myUserId, username } = action;
      return {
        ...state,
        // Clear countdown — the new timer arrives via turn_timer_started.
        turnTimer: null,
        moveLog: [
          ...state.moveLog,
          {
            handNumber: data.handNumber ?? null,
            username,
            suit: data.suit,
            value: data.value,
            signal: data.signal ?? null,
          },
        ],
        // A signal can only be declared on the first card of a trick; a new
        // trick led without one clears the previous trick's signal.
        currentSignal: data.signal
          ? { userId: data.userId, signal: data.signal }
          : data.position === 0
            ? null
            : state.currentSignal,
        myCards:
          data.userId === myUserId
            ? state.myCards.filter(
                (c) => !(c.suit === data.suit && c.value === data.value),
              )
            : state.myCards,
        playedCards: [...state.playedCards, data],
      };
    }

    case "briscola_chosen":
      return {
        ...state,
        turnTimer: null,
        currentRound: state.currentRound
          ? { ...state.currentRound, briscola: action.briscola }
          : state.currentRound,
      };

    case "round_ended": {
      const { data } = action;
      return {
        ...state,
        roundEndData: {
          roundNumber: data.roundNumber,
          team0Points: data.team0.points,
          team1Points: data.team1.points,
          team0Figures: data.team0.figures,
          team1Figures: data.team1.figures,
          winnerTeam: data.winnerTeam,
        },
      };
    }

    case "round_end_dismissed":
      return { ...state, roundEndData: null };

    case "game_finished":
      return { ...state, gameFinishedData: action.data, roundEndData: null };

    case "turn_timer_started":
      return {
        ...state,
        currentTurnUserId: action.timer.turnUserId,
        playableCards: [],
        turnTimer: action.timer,
      };
  }
}

/**
 * Server-driven game state for the table page: fetches and refetches
 * GET /games/:code/state, keeps it in sync with the game socket events, and
 * loads playable cards when it's this player's turn.
 *
 * UI-only state (dialog flags, countdown rendering, connection banner) stays
 * in the page.
 */
export function useGameTable(
  gameRoomCode: string | undefined,
  userId: number | null,
  username: string,
  players: { userId: number; username: string }[],
) {
  const [state, dispatch] = useReducer(gameTableReducer, initialGameTableState);

  // Refs so the socket handlers below don't re-register when these change.
  const userIdRef = useRef(userId);
  const gameRoomCodeRef = useRef(gameRoomCode);
  const playersRef = useRef(players);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    gameRoomCodeRef.current = gameRoomCode;
  }, [gameRoomCode]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  const usernameOf = useCallback(
    (uid: number) => playersRef.current.find((p) => p.userId === uid)?.username,
    [],
  );

  const refetchGameState = useCallback(async () => {
    const uid = userIdRef.current;
    const code = gameRoomCodeRef.current;
    if (!uid || !code) return;

    try {
      const data = await apiGet<GameStateResponse>(`/games/${code}/state`);
      dispatch({ type: "state_fetched", data, now: Date.now() });

      // Fetch playable cards immediately if it's our turn
      if (data.currentTurnUserId === uid && data.round?.briscola) {
        const pcData = await apiGet<{ playableCards?: PlayerCard[] }>(
          `/games/playable-cards/${code}`,
        );
        dispatch({
          type: "playable_cards_fetched",
          cards: pcData.playableCards ?? [],
        });
      }
    } catch (error) {
      console.error("Error refetching game state:", error);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!userId || !gameRoomCode) return;
    refetchGameState();
  }, [userId, gameRoomCode, refetchGameState]);

  // Fetch playable cards when it's my turn
  useEffect(() => {
    if (!userId || !gameRoomCode || state.currentTurnUserId !== userId) {
      dispatch({ type: "playable_cards_fetched", cards: [] });
      return;
    }

    const fetchPlayableCards = async () => {
      try {
        const data = await apiGet<{ playableCards?: PlayerCard[] }>(
          `/games/playable-cards/${gameRoomCode}`,
        );
        dispatch({
          type: "playable_cards_fetched",
          cards: data.playableCards ?? [],
        });
      } catch (error) {
        console.error("Error fetching playable cards:", error);
      }
    };

    fetchPlayableCards();
  }, [
    state.currentTurnUserId,
    userId,
    gameRoomCode,
    state.currentRound?.briscola,
    state.playedCards.length,
    state.myCards.length,
    state.turnTimer,
  ]);

  // A completed trick (4 cards) refetches after 3 seconds, giving the backend
  // time to create the next hand; incomplete tricks refetch after 300ms (see
  // handleCardPlayed below).
  useEffect(() => {
    if (state.playedCards.length !== 4) return;

    const timer = setTimeout(() => {
      refetchGameState();
    }, 3000);

    return () => clearTimeout(timer);
  }, [state.playedCards.length, refetchGameState]);

  // When the socket reconnects, refetch to catch any missed events.
  useEffect(() => {
    return onConnectionStatusChange((status) => {
      if (status === "connected") {
        refetchGameState();
      }
    });
  }, [refetchGameState]);

  // Game socket events
  useEffect(() => {
    if (!userId || !username || !gameRoomCode) return;

    // Register room handlers (joins socket room, sets up reconnect auto-rejoin)
    registerRoomHandlers(gameRoomCode, { userId, username });
    const unsubscribeErrorToast = registerErrorToast();

    const socket = getSocket();

    const handleCardPlayed = (data: CardPlayedPayload) => {
      dispatch({
        type: "card_played",
        data,
        myUserId: userIdRef.current,
        username: usernameOf(data.userId) ?? `#${data.userId}`,
      });
      // position is the card's index in the trick, so position + 1 is the
      // trick size after this play. The completed-trick case is handled by
      // the 3-second effect above.
      if (data.position + 1 < 4) {
        setTimeout(() => refetchGameState(), 300);
      }
    };

    const handleBriscolaChosen = (data: BriscolaChosenPayload) => {
      dispatch({ type: "briscola_chosen", briscola: data.briscola });
      // Refetch to get updated turn info
      setTimeout(() => refetchGameState(), 300);
    };

    const handleRoundEnded = (data: RoundEndedPayload) => {
      dispatch({ type: "round_ended", data });
    };

    const handleNewRoundStarted = () => {
      toast.success("Nuovo round iniziato!");
      refetchGameState();
    };

    const handleGameFinished = (data: GameFinishedPayload) => {
      dispatch({ type: "game_finished", data });
    };

    const handlePlayerDisconnected = (data: PlayerDisconnectedPayload) => {
      toast.warning(`${data.username} si è disconnesso`);
    };

    const handleTurnTimerStarted = (data: TurnTimerStartedPayload) => {
      // Anchor on receipt time, not the server's clock (skew-safe: the timer
      // just started, so transit latency is the only error).
      dispatch({
        type: "turn_timer_started",
        timer: {
          turnUserId: data.turnUserId,
          totalMs: data.totalMs,
          startedAt: Date.now(),
          phase: data.phase,
        },
      });
    };

    const handleAutoPlayed = (data: AutoPlayedPayload) => {
      const playerName = usernameOf(data.userId) ?? "Giocatore";
      toast.info(`${playerName} ha giocato automaticamente (tempo scaduto)`);
    };

    const handlePlayerKickedTimeout = (data: PlayerKickedTimeoutPayload) => {
      toast.warning(`${data.username} è stato rimosso per inattività`);
    };

    socket.on("card_played", handleCardPlayed);
    socket.on("briscola_chosen", handleBriscolaChosen);
    socket.on("round_ended", handleRoundEnded);
    socket.on("new_round_started", handleNewRoundStarted);
    socket.on("game_finished", handleGameFinished);
    socket.on("player_disconnected", handlePlayerDisconnected);
    socket.on("turn_timer_started", handleTurnTimerStarted);
    socket.on("auto_played", handleAutoPlayed);
    socket.on("player_kicked_timeout", handlePlayerKickedTimeout);

    return () => {
      unsubscribeErrorToast();
      socket.off("card_played", handleCardPlayed);
      socket.off("briscola_chosen", handleBriscolaChosen);
      socket.off("round_ended", handleRoundEnded);
      socket.off("new_round_started", handleNewRoundStarted);
      socket.off("game_finished", handleGameFinished);
      socket.off("player_disconnected", handlePlayerDisconnected);
      socket.off("turn_timer_started", handleTurnTimerStarted);
      socket.off("auto_played", handleAutoPlayed);
      socket.off("player_kicked_timeout", handlePlayerKickedTimeout);
    };
  }, [userId, username, gameRoomCode, refetchGameState, usernameOf]);

  const dismissRoundEnd = useCallback(
    () => dispatch({ type: "round_end_dismissed" }),
    [],
  );

  // Local echo of a briscola choice, so the caller's own UI updates without
  // waiting for the server's briscola_chosen event.
  const applyLocalBriscola = useCallback(
    (suit: string) => dispatch({ type: "briscola_chosen", briscola: suit }),
    [],
  );

  return { ...state, refetchGameState, dismissRoundEnd, applyLocalBriscola };
}
