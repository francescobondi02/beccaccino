import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import {
  leaveRoom,
  registerRoomHandlers,
  subscribeToRoomEvent,
} from "@/sockets/roomHandlers";
import type {
  CardPlayedPayload,
  BriscolaChosenPayload,
  GameFinishedPayload,
  NewRoundStartedPayload,
  TurnTimerStartedPayload,
  AutoPlayedPayload,
  PlayerControlChangedPayload,
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
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
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
  const requestController = useRef<AbortController | null>(null);
  const visibleCompletedTrick = state.completedTricks[0];
  const fastCollection = Boolean(visibleCompletedTrick && (
    visibleCompletedTrick.cards[0].handNumber === 10 ||
    visibleCompletedTrick.roundId !== state.currentRound?.id ||
    state.gameFinishedData
  ));

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
    const signal = requestController.current?.signal;
    if (!signal || signal.aborted) return;
    const requestId = ++playableRequestSequence.current;
    try {
      const data = await apiGet<{ playableCards?: PlayerCard[] }>(
        `/games/playable-cards/${code}`,
        signal,
      );
      if (signal.aborted || requestId !== playableRequestSequence.current) return;
      dispatch({
        type: "playable_cards_fetched",
        cards: data.playableCards ?? [],
      });
    } catch (error) {
      if (signal.aborted || requestId !== playableRequestSequence.current) return;
      console.error("Error fetching playable cards:", error);
    }
  }, []);

  const refetchGameState = useCallback(async () => {
    const uid = userIdRef.current;
    const code = gameRoomCodeRef.current;
    const signal = requestController.current?.signal;
    if (!uid || !code || !signal || signal.aborted) return;

    const requestId = ++stateRequestSequence.current;
    if (!hasLoadedGameState.current) {
      setGameStateStatus("loading");
    }
    try {
      const data = await apiGet<GameStateResponse>(`/games/${code}/state`, signal);
      if (signal.aborted || requestId !== stateRequestSequence.current) return;

      dispatch({ type: "state_fetched", data, now: Date.now() });
      hasLoadedGameState.current = true;
      setGameStateStatus("ready");

      // Fetch playable cards immediately if it's our turn
      if (
        data.status !== "paused" &&
        !data.playerControls?.some((player) => player.userId === uid && player.botModel !== null) &&
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
      if (signal.aborted || requestId !== stateRequestSequence.current) return;
      console.error("Error refetching game state:", error);
      if (!hasLoadedGameState.current) {
        setGameStateStatus("error");
      }
    }
  }, [fetchPlayableCards]);

  const setRequestsEnabled = useCallback((enabled: boolean) => {
    const controller = requestController.current;
    if (!controller) return;
    if (!enabled) {
      controller.abort();
    } else if (controller.signal.aborted) {
      requestController.current = new AbortController();
      void refetchGameState();
    }
  }, [refetchGameState]);

  // Initial load
  useEffect(() => {
    if (!userId || !gameRoomCode) return;
    requestController.current = new AbortController();
    hasLoadedGameState.current = false;
    setGameStateStatus("loading");
    void refetchGameState();
    return () => {
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [userId, gameRoomCode, refetchGameState]);

  // Fetch playable cards when it's my turn
  useEffect(() => {
    const canRequestPlayableCards =
      state.gameStatus !== "paused" &&
      !state.playerControls.some((player) => player.userId === userId && player.botModel !== null) &&
      state.completedTricks.length === 0 &&
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
    state.gameStatus,
    state.playerControls,
    state.currentTurnUserId,
    userId,
    gameRoomCode,
    state.currentRound?.briscola,
    state.currentHandNumber,
    state.playedCards.length,
    state.completedTricks.length,
    state.myCards.length,
    state.turnTimer,
    fetchPlayableCards,
  ]);

  // Keep the completed trick visible while authoritative state continues to
  // reconcile underneath it.
  useEffect(() => {
    if (!visibleCompletedTrick) return;

    const timer = setTimeout(() => {
      dispatch({ type: "completed_trick_released" });
      void refetchGameState();
    }, fastCollection ? 1000 : 3000);

    return () => clearTimeout(timer);
  }, [visibleCompletedTrick, fastCollection, refetchGameState]);

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
    const cancelScheduledRefetches = () => {
      reconciliationTimers.forEach((timer) => clearTimeout(timer));
      reconciliationTimers.clear();
    };
    const scheduleRefetch = (delay: number) => {
      const timer = setTimeout(() => {
        reconciliationTimers.delete(timer);
        void refetchGameState();
      }, delay);
      reconciliationTimers.add(timer);
    };
    const invalidateStateRequests = () => {
      stateRequestSequence.current += 1;
    };

    const handleCardPlayed = (data: CardPlayedPayload) => {
      cancelScheduledRefetches();
      invalidateStateRequests();
      playableRequestSequence.current += 1;
      dispatch({
        type: "card_played",
        data,
        myUserId: userIdRef.current,
        username: usernameOf(data.userId) ?? `#${data.userId}`,
      });
      // position is the card's index in the trick, so position + 1 is the
      // trick size after this play. Completed tricks use the hold effect above.
      if (data.position + 1 < 4) {
        scheduleRefetch(300);
      }
    };

    const handleBriscolaChosen = (data: BriscolaChosenPayload) => {
      invalidateStateRequests();
      dispatch({ type: "briscola_chosen", briscola: data.briscola });
      // Refetch to get updated turn info
      scheduleRefetch(300);
    };

    const handleNewRoundStarted = (data: NewRoundStartedPayload) => {
      invalidateStateRequests();
      playableRequestSequence.current += 1;
      dispatch({ type: "new_round_started", data });
      setNotice(`Inizio del round ${data.roundNumber}`);
      void refetchGameState();
    };

    const handleGameFinished = (data: GameFinishedPayload) => {
      invalidateStateRequests();
      dispatch({ type: "game_finished", data });
    };

    const handlePlayerDisconnected = (data: PlayerDisconnectedPayload) => {
      setNotice(`${data.username} si è disconnesso. Il suo posto resta riservato.`);
    };

    const handleTurnTimerStarted = (data: TurnTimerStartedPayload) => {
      invalidateStateRequests();
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
      setNotice(`${playerName}: tempo scaduto, ${data.phase === "choose_briscola" ? "briscola scelta" : "carta giocata"} automaticamente.`);
    };

    const handlePlayerControlChanged = (data: PlayerControlChangedPayload) => {
      invalidateStateRequests();
      playableRequestSequence.current += 1;
      dispatch({ type: "player_control_changed", player: data });
      setNotice(data.abandonedAt
        ? `${data.username} ha abbandonato. Continua un bot al suo posto.`
        : data.botModel
          ? `${data.username} è inattivo: gioca un bot finché non riprende il controllo.`
          : `${data.username} ha ripreso il controllo.`);
      void refetchGameState();
    };

    const handlePracticeLifecycleChanged = () => {
      invalidateStateRequests();
      playableRequestSequence.current += 1;
      void refetchGameState();
    };

    const unsubscribers = [
      subscribeToRoomEvent("card_played", handleCardPlayed),
      subscribeToRoomEvent("briscola_chosen", handleBriscolaChosen),
      subscribeToRoomEvent("new_round_started", handleNewRoundStarted),
      subscribeToRoomEvent("game_finished", handleGameFinished),
      subscribeToRoomEvent("player_disconnected", handlePlayerDisconnected),
      subscribeToRoomEvent("turn_timer_started", handleTurnTimerStarted),
      subscribeToRoomEvent("auto_played", handleAutoPlayed),
      subscribeToRoomEvent(
        "player_control_changed",
        handlePlayerControlChanged,
      ),
      subscribeToRoomEvent(
        "practice_paused",
        handlePracticeLifecycleChanged,
      ),
      subscribeToRoomEvent(
        "practice_resumed",
        handlePracticeLifecycleChanged,
      ),
      subscribeToRoomEvent("practice_abandoned", ({ roomCode }) => {
        if (roomCode !== gameRoomCode) return;
        setRequestsEnabled(false);
        cancelScheduledRefetches();
      }),
    ];

    return () => {
      stateRequestSequence.current += 1;
      playableRequestSequence.current += 1;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unregisterRoom();
      leaveRoom(gameRoomCode);
      cancelScheduledRefetches();
    };
  }, [userId, username, gameRoomCode, refetchGameState, usernameOf, setRequestsEnabled]);

  // Local echo of a briscola choice, so the caller's own UI updates without
  // waiting for the server's briscola_chosen event.
  const applyLocalBriscola = useCallback(
    (suit: string) => dispatch({ type: "briscola_chosen", briscola: suit }),
    [],
  );

  const { completedTricks, ...visibleState } = state;
  const visibleCards = visibleCompletedTrick?.cards ?? visibleState.playedCards;
  const visibleLead = visibleCards.find((card) => card.position === 0);

  return {
    ...visibleState,
    notice,
    completedTrick: visibleCompletedTrick,
    fastCollection,
    playedCards: visibleCards,
    currentSignal: visibleLead?.signal
      ? {
          userId: visibleLead.userId,
          signal: visibleLead.signal,
          cardKey: `${visibleLead.suit}-${visibleLead.value}`,
        }
      : null,
    currentTurnUserId:
      visibleCompletedTrick ? null : visibleState.currentTurnUserId,
    turnTimer: visibleCompletedTrick ? null : visibleState.turnTimer,
    playableCards:
      completedTricks.length > 0 ? [] : visibleState.playableCards,
    gameStateStatus,
    refetchGameState,
    setRequestsEnabled,
    applyLocalBriscola,
  };
}
