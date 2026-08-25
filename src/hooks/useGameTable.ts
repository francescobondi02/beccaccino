import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import {
  registerRoomHandlers,
  subscribeToRoomEvent,
} from "@/sockets/roomHandlers";
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
import type { GameStateResponse, PlayerCard } from "@/game/model";
import {
  gameTableReducer,
  initialGameTableState,
} from "@/game/state";

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
  const [gameStateStatus, setGameStateStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");

  // Refs so the socket handlers below don't re-register when these change.
  const userIdRef = useRef(userId);
  const gameRoomCodeRef = useRef(gameRoomCode);
  const playersRef = useRef(players);
  const stateRequestSequence = useRef(0);
  const playableRequestSequence = useRef(0);
  const hasLoadedGameState = useRef(false);

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

  const fetchPlayableCards = useCallback(async (code: string) => {
    const requestId = ++playableRequestSequence.current;
    try {
      const data = await apiGet<{ playableCards?: PlayerCard[] }>(
        `/games/playable-cards/${code}`,
      );
      if (requestId !== playableRequestSequence.current) return;
      dispatch({
        type: "playable_cards_fetched",
        cards: data.playableCards ?? [],
      });
    } catch (error) {
      if (requestId !== playableRequestSequence.current) return;
      console.error("Error fetching playable cards:", error);
    }
  }, []);

  const refetchGameState = useCallback(async () => {
    const uid = userIdRef.current;
    const code = gameRoomCodeRef.current;
    if (!uid || !code) return;

    const requestId = ++stateRequestSequence.current;
    if (!hasLoadedGameState.current) {
      setGameStateStatus("loading");
    }
    try {
      const data = await apiGet<GameStateResponse>(`/games/${code}/state`);
      if (requestId !== stateRequestSequence.current) return;

      dispatch({ type: "state_fetched", data, now: Date.now() });
      hasLoadedGameState.current = true;
      setGameStateStatus("ready");

      // Fetch playable cards immediately if it's our turn
      if (
        data.currentTurnUserId === uid &&
        data.round?.briscola &&
        data.currentHandNumber !== null &&
        (data.playedCards?.length ?? 0) < 4
      ) {
        await fetchPlayableCards(code);
      } else {
        playableRequestSequence.current += 1;
        dispatch({ type: "playable_cards_fetched", cards: [] });
      }
    } catch (error) {
      if (requestId !== stateRequestSequence.current) return;
      console.error("Error refetching game state:", error);
      setGameStateStatus("error");
    }
  }, [fetchPlayableCards]);

  // Initial load
  useEffect(() => {
    if (!userId || !gameRoomCode) return;
    hasLoadedGameState.current = false;
    setGameStateStatus("loading");
    void refetchGameState();
  }, [userId, gameRoomCode, refetchGameState]);

  // Fetch playable cards when it's my turn
  useEffect(() => {
    const canRequestPlayableCards =
      Boolean(state.currentRound?.briscola) &&
      state.currentHandNumber !== null &&
      state.playedCards.length < 4 &&
      state.currentTurnUserId === userId;

    if (!userId || !gameRoomCode || !canRequestPlayableCards) {
      playableRequestSequence.current += 1;
      dispatch({ type: "playable_cards_fetched", cards: [] });
      return;
    }

    void fetchPlayableCards(gameRoomCode);
  }, [
    state.currentTurnUserId,
    userId,
    gameRoomCode,
    state.currentRound?.briscola,
    state.currentHandNumber,
    state.playedCards.length,
    state.myCards.length,
    state.turnTimer,
    fetchPlayableCards,
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

  // Game socket events
  useEffect(() => {
    if (!userId || !username || !gameRoomCode) return;

    const unregisterRoom = registerRoomHandlers(
      gameRoomCode,
      {
        userId,
        username,
      },
      () => void refetchGameState(),
    );
    const reconciliationTimers = new Set<ReturnType<typeof setTimeout>>();
    const scheduleRefetch = (delay: number) => {
      const timer = setTimeout(() => {
        reconciliationTimers.delete(timer);
        void refetchGameState();
      }, delay);
      reconciliationTimers.add(timer);
    };

    const handleCardPlayed = (data: CardPlayedPayload) => {
      playableRequestSequence.current += 1;
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
        scheduleRefetch(300);
      }
    };

    const handleBriscolaChosen = (data: BriscolaChosenPayload) => {
      dispatch({ type: "briscola_chosen", briscola: data.briscola });
      // Refetch to get updated turn info
      scheduleRefetch(300);
    };

    const handleRoundEnded = (data: RoundEndedPayload) => {
      dispatch({ type: "round_ended", data });
    };

    const handleNewRoundStarted = () => {
      playableRequestSequence.current += 1;
      dispatch({ type: "new_round_started" });
      toast.success("Nuovo round iniziato!");
      void refetchGameState();
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

    const unsubscribers = [
      subscribeToRoomEvent("card_played", handleCardPlayed),
      subscribeToRoomEvent("briscola_chosen", handleBriscolaChosen),
      subscribeToRoomEvent("round_ended", handleRoundEnded),
      subscribeToRoomEvent("new_round_started", handleNewRoundStarted),
      subscribeToRoomEvent("game_finished", handleGameFinished),
      subscribeToRoomEvent("player_disconnected", handlePlayerDisconnected),
      subscribeToRoomEvent("turn_timer_started", handleTurnTimerStarted),
      subscribeToRoomEvent("auto_played", handleAutoPlayed),
      subscribeToRoomEvent(
        "player_kicked_timeout",
        handlePlayerKickedTimeout,
      ),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unregisterRoom();
      reconciliationTimers.forEach((timer) => clearTimeout(timer));
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

  return {
    ...state,
    gameStateStatus,
    refetchGameState,
    dismissRoundEnd,
    applyLocalBriscola,
  };
}
