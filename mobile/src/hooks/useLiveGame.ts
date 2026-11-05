import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Socket } from 'socket.io-client';

import { readGameState, readPlayable, readRoom, record, type GameState, type Room, type Trick } from '@/lib/game';
import { sessionRequest, SessionHttpError, type SessionUser } from '@/lib/session';
import { authFailures, openSocket } from '@/lib/socket';

type Snapshot = { room: Room; game: GameState; playable: ReturnType<typeof readPlayable>; receivedAt: number };
type Connection = 'connecting' | 'ready' | 'offline';
type Controls = {
  refresh: () => Promise<void>;
  mutate: (path: string, body: unknown) => Promise<boolean>;
};
const gameEvents = new Set([
  'card_played', 'briscola_chosen', 'new_round_started', 'round_ended', 'game_finished',
  'turn_timer_started', 'auto_played', 'player_control_changed', 'practice_paused',
  'practice_resumed', 'practice_abandoned',
]);

export default function useLiveGame(code: string, user: SessionUser) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [completedTrick, setCompletedTrick] = useState<Trick | null>(null);
  const finishCollection = useCallback(() => setCompletedTrick(null), []);
  const controls = useRef<Controls | null>(null);

  useEffect(() => {
    const lifetime = new AbortController();
    let socket: Socket | null = null;
    let latest: Snapshot | null = null;
    let revision = 0;
    let fetching: Promise<void> | null = null;
    let dirty = false;
    let mutation = false;
    let joined = false;
    let lastTrickKey: string | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let reconciliation: ReturnType<typeof setTimeout> | undefined;
    const report = (cause: unknown) => {
      if (lifetime.signal.aborted) return;
      if (cause instanceof SessionHttpError && cause.status === 401) setNeedsLogin(true);
      setError(cause instanceof Error ? cause.message : 'Collegamento al tavolo non riuscito.');
    };
    const refresh = (): Promise<void> => {
      clearTimeout(reconciliation);
      dirty = true;
      if (fetching) return fetching;
      if (lifetime.signal.aborted || !joined) return Promise.resolve();
      setSyncing(true);
      fetching = (async () => {
        while (dirty && !lifetime.signal.aborted && joined) {
          dirty = false;
          const version = revision;
          const room = latest?.room ?? readRoom(await sessionRequest(`/api/rooms/${code}`, lifetime.signal));
          if (!room.players.some((p) => p.userId === user.id)) throw new Error('Il tuo posto non è presente nella stanza.');
          const game = readGameState(await sessionRequest(`/api/games/${code}/state`, lifetime.signal));
          const knownPlayer = (userId: number) => room.players.some((p) => p.userId === userId);
          if (game.playedCards.some((card) => !knownPlayer(card.userId)) ||
            (game.lastCompletedTrick && (!knownPlayer(game.lastCompletedTrick.winnerUserId) ||
              game.lastCompletedTrick.cards.some((card) => !knownPlayer(card.userId))))) {
            throw new Error('Il tavolo contiene giocatori non riconosciuti.');
          }
          const receivedAt = Date.now();
          const canPlay = game.status === 'playing' && game.currentTurnUserId === user.id &&
            game.currentHandNumber !== null && !game.playerControls.some((p) => p.userId === user.id && p.botModel);
          const playable = canPlay ? readPlayable(await sessionRequest(`/api/games/playable-cards/${code}`, lifetime.signal)) : [];
          if (lifetime.signal.aborted || !joined || version !== revision) continue;
          const trick = game.lastCompletedTrick;
          const key = trick ? `${trick.roundId}:${trick.handNumber}` : null;
          if (latest && trick && key !== lastTrickKey) setCompletedTrick(trick);
          lastTrickKey = key;
          latest = { room, game, playable, receivedAt };
          setSnapshot(latest);
          setError(null);
          setConnection('ready');
        }
      })().catch(report).finally(() => {
        fetching = null;
        if (!lifetime.signal.aborted) setSyncing(false);
      });
      return fetching;
    };
    const mutate = async (path: string, body: unknown): Promise<boolean> => {
      if (mutation || lifetime.signal.aborted) return false;
      mutation = true;
      setBusy(true);
      setError(null);
      try {
        await sessionRequest(path, lifetime.signal, body);
        await refresh();
        return !lifetime.signal.aborted;
      } catch (cause) {
        report(cause);
        // A timed-out POST may already have committed. Reconcile; never resend it.
        await refresh();
        report(cause);
        return false;
      } finally {
        mutation = false;
        if (!lifetime.signal.aborted) setBusy(false);
      }
    };
    controls.current = {
      refresh: async () => {
        if (!socket) { setAttempt((value) => value + 1); return; }
        if (joined) await refresh();
        else { socket?.disconnect(); socket?.connect(); }
      },
      mutate,
    };
    const start = async () => {
      const created = await openSocket();
      if (lifetime.signal.aborted) return;
      socket = created;
      socket.on('connect', () => {
        clearTimeout(retry);
        setConnection('connecting');
        socket?.timeout(8_000).emit('join_room', { roomCode: code, userId: user.id, username: user.username },
          (failure: Error | null, response: unknown) => {
            if (lifetime.signal.aborted || !socket?.connected) return;
            try {
              if (failure || record(response).ok !== true) throw new Error('Non riesco a entrare nel tavolo. Riprova.');
              joined = true;
              revision++;
              void refresh();
            } catch (cause) { report(cause); setConnection('offline'); }
          });
      });
      socket.on('disconnect', () => {
        joined = false;
        revision++;
        if (!lifetime.signal.aborted) setConnection('offline');
      });
      socket.on('connect_error', (cause: Error) => {
        if (lifetime.signal.aborted) return;
        setConnection('offline');
        if (authFailures.includes(cause.message)) {
          socket?.disconnect();
          report(new SessionHttpError(401));
        } else {
          report(new Error('Connessione interrotta. Riprovo a raggiungere il tavolo.'));
          if (!socket?.active) retry = setTimeout(() => socket?.connect(), 5000);
        }
      });
      socket.onAny((event: string) => {
        if (!gameEvents.has(event)) return;
        revision++;
        setSyncing(true);
        clearTimeout(reconciliation);
        if (fetching) { dirty = true; return; }
        reconciliation = setTimeout(() => void refresh(), 150);
      });
      if (AppState.currentState === 'active') socket.connect();
    };
    void start().catch(report);
    const subscription = AppState.addEventListener('change', (state) => {
      // Only practice tables can pause; multiplayer seats keep running and fall back to timeouts.
      if (state === 'background' && latest?.room.isPractice && !['paused', 'finished'].includes(latest.game.status)) {
        void mutate(`/api/rooms/${code}/pause`, {});
      }
      if (state === 'active') {
        if (socket?.connected) void refresh();
        else socket?.connect();
      } else {
        clearTimeout(retry);
        clearTimeout(reconciliation);
        socket?.disconnect();
      }
    });
    return () => {
      controls.current = null;
      lifetime.abort();
      clearTimeout(retry);
      subscription.remove();
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [attempt, code, user.id, user.username]);

  return {
    snapshot, connection, error, needsLogin, busy, syncing, completedTrick,
    finishCollection,
    refresh: () => controls.current?.refresh(),
    mutate: (path: string, body: unknown) => controls.current?.mutate(path, body) ?? Promise.resolve(false),
  };
}
