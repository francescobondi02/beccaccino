import { useCallback, useEffect, useMemo, useState } from "react";
import { replaceEqualDeep, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GameState, LastAction, PlayedCard } from "@contract/game";
import { apiGet } from "@/lib/api";
import { cardKey } from "@/game/presentation";
import { leaveRoom, registerRoomHandlers } from "@/sockets/roomHandlers";
import { subscribe } from "@/sockets/socketClient";

// The final trick of a round leaves the table early for the round summary.
const FINAL_TRICK_EARLY_MS = 2000;

// Client update rule: drop an older state, replace an equal or newer one.
// replaceEqualDeep keeps unchanged parts by reference, so the table does not
// restart animations when the same state arrives twice.
function keepNewer(old: GameState | undefined, next: GameState): GameState {
  return old && next.version < old.version ? old : replaceEqualDeep(old, next);
}

function actionNotice(action: LastAction, username: (userId: number) => string) {
  switch (action.kind) {
    case "briscola_chosen":
    case "card_played":
      if (action.source !== "timeout") return null;
      return `${username(action.userId)}: tempo scaduto, ${
        action.kind === "briscola_chosen" ? "briscola scelta" : "carta giocata"
      } automaticamente.`;
    case "control_changed":
      return action.botModel
        ? `${username(action.userId)} è inattivo: gioca un bot finché non riprende il controllo.`
        : `${username(action.userId)} ha ripreso il controllo.`;
    case "abandoned":
      return `${username(action.userId)} ha abbandonato. Continua un bot al suo posto.`;
    default:
      return null;
  }
}

/**
 * The table's GameState in React Query ["game", roomCode]. Pushes, mutation
 * responses and refetches all go through keepNewer. Display timing (last
 * trick on the table, deal, countdown) uses the server clock.
 */
export function useGameTable(roomCode: string | undefined, userId: number | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["game", roomCode],
    queryFn: ({ signal }) => apiGet<GameState>(`/games/${roomCode}/state`, signal),
    enabled: Boolean(userId && roomCode),
    retry: false,
    structuralSharing: (old, next) =>
      keepNewer(old as GameState | undefined, next as GameState),
  });
  const gameState = query.data;

  const applyGameState = useCallback(
    (state: GameState) => {
      if (state.roomCode !== roomCode) return;
      queryClient.setQueryData<GameState>(["game", roomCode], (old) => keepNewer(old, state));
    },
    [queryClient, roomCode],
  );

  const refetchGameState = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["game", roomCode] }),
    [queryClient, roomCode],
  );

  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  const serverTime = gameState?.serverTime;
  const clockOffset = useMemo(
    () => (serverTime ? Date.parse(serverTime) - Date.now() : 0),
    [serverTime],
  );
  const localTime = useCallback((iso: string) => Date.parse(iso) - clockOffset, [clockOffset]);

  const lastTrick = gameState?.lastTrick ?? null;
  const fastCollection = lastTrick?.trickNumber === 10;
  const lastTrickLeavesAt = lastTrick
    ? localTime(lastTrick.onTableUntil) - (fastCollection ? FINAL_TRICK_EARLY_MS : 0)
    : 0;
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const delay = lastTrickLeavesAt - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(() => setClockTick((tick) => tick + 1), delay);
    return () => clearTimeout(timer);
  }, [lastTrickLeavesAt]);
  const completedTrick = lastTrick && Date.now() < lastTrickLeavesAt ? lastTrick : null;

  // Animate lastAction once per new version, never for an equal one. A card of
  // the next trick waits until the completed trick leaves the table.
  const [seen, setSeen] = useState<{
    version: number;
    animatedCard: PlayedCard | null;
    heldCard: PlayedCard | null;
  }>({ version: -1, animatedCard: null, heldCard: null });
  if (gameState && gameState.version > seen.version) {
    const action = gameState.lastAction;
    const card: PlayedCard | null = action?.kind === "card_played"
      ? { ...action.card, userId: action.userId, signal: action.signal }
      : null;
    const held = card && completedTrick &&
      !completedTrick.cards.some((played) => cardKey(played) === cardKey(card));
    setSeen({
      version: gameState.version,
      animatedCard: held ? seen.animatedCard : card,
      heldCard: held ? card : card ? null : seen.heldCard,
    });
    const message = action && actionNotice(action, (id) =>
      gameState.players.find((player) => player.userId === id)?.username ?? "Giocatore");
    if (message) setNotice(message);
  } else if (seen.heldCard && !completedTrick) {
    setSeen({ ...seen, animatedCard: seen.heldCard, heldCard: null });
  }

  const deal = gameState?.round.deal ?? null;
  const roundDeal = useMemo(
    () => deal && {
      animationEndsAt: localTime(deal.animationEndsAt),
      reviewEndsAt: localTime(deal.reviewEndsAt),
    },
    [deal, localTime],
  );

  useEffect(() => {
    if (!userId || !roomCode) return;

    // Runs on every socket (re)connect: refetch what a disconnect missed.
    const unregisterRoom = registerRoomHandlers(roomCode, () => void refetchGameState());
    const unsubscribers = [
      subscribe("game_state", applyGameState),
      subscribe("room_changed", () => void refetchGameState()),
      subscribe("player_disconnected", ({ username }) => {
        setNotice(`${username} si è disconnesso. Il suo posto resta riservato.`);
      }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unregisterRoom();
      leaveRoom(roomCode);
    };
  }, [userId, roomCode, applyGameState, refetchGameState]);

  const turn = completedTrick ? null : gameState?.turn ?? null;
  const playedCards = completedTrick?.cards ?? gameState?.trick?.cards ?? [];
  const lead = playedCards[0];

  return {
    gameState,
    error: query.error,
    notice,
    completedTrick,
    fastCollection,
    playedCards,
    animatedCard: seen.animatedCard,
    currentSignal: lead?.signal
      ? { userId: lead.userId, signal: lead.signal, cardKey: cardKey(lead) }
      : null,
    currentTurnUserId: turn?.userId ?? null,
    turnDeadline: turn?.deadline ? localTime(turn.deadline) : null,
    playableCards: completedTrick ? [] : gameState?.playableCards ?? [],
    roundDeal,
    applyGameState,
    refetchGameState,
  };
}
