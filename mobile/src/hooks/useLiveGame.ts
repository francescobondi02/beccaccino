import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Socket } from 'socket.io-client';

import type { GameState } from '@contract/game';
import type { Trick } from '@/lib/game';
import { sessionRequest, SessionHttpError } from '@/lib/session';
import { authFailures, openSocket } from '@/lib/socket';

// clockOffset turns Date.now() into server time.
type Snapshot = { game: GameState; clockOffset: number };
type Connection = 'connecting' | 'ready' | 'offline';
type Controls = {
  refresh: () => Promise<void>;
  mutate: (path: string, body: unknown) => Promise<boolean>;
};

export default function useLiveGame(code: string) {
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
    let fetching: Promise<void> | null = null;
    let dirty = false;
    let mutation = false;
    let joined = false;
    let lastTrickKey: string | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const report = (cause: unknown) => {
      if (lifetime.signal.aborted) return;
      if (cause instanceof SessionHttpError && cause.status === 401) setNeedsLogin(true);
      setError(cause instanceof Error ? cause.message : 'Collegamento al tavolo non riuscito.');
    };
    // Client update rule: ignore another table or an older version; replace on an equal or newer one.
    const apply = (game: GameState) => {
      if (lifetime.signal.aborted || game.roomCode !== code || (latest && game.version < latest.game.version)) return;
      const trick = game.lastTrick;
      const key = trick ? `${trick.roundNumber}:${trick.trickNumber}` : null;
      if (latest && trick && key !== lastTrickKey) setCompletedTrick(trick);
      lastTrickKey = key;
      latest = { game, clockOffset: Date.parse(game.serverTime) - Date.now() };
      setSnapshot(latest);
      setError(null);
    };
    const refresh = (): Promise<void> => {
      dirty = true;
      if (fetching) return fetching;
      if (lifetime.signal.aborted || !joined) return Promise.resolve();
      setSyncing(true);
      fetching = (async () => {
        while (dirty && !lifetime.signal.aborted && joined) {
          dirty = false;
          apply(await sessionRequest(`/api/games/${code}/state`, lifetime.signal) as GameState);
          if (!lifetime.signal.aborted && joined) setConnection('ready');
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
        const response = await sessionRequest(path, lifetime.signal, body);
        // Game routes answer with the new state; room routes push it, and a refetch covers a missed push.
        if (path.startsWith('/api/games/')) apply(response as GameState);
        else await refresh();
        return !lifetime.signal.aborted;
      } catch (cause) {
        // A timed-out POST may already have committed. Reconcile; never resend it, then show why it failed.
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
        socket?.timeout(8_000).emit('join_room', { roomCode: code },
          (failure: Error | null, response: unknown) => {
            if (lifetime.signal.aborted || !socket?.connected) return;
            try {
              if (failure || (response as { ok?: unknown } | null)?.ok !== true) throw new Error('Non riesco a entrare nel tavolo. Riprova.');
              joined = true;
              void refresh();
            } catch (cause) { report(cause); setConnection('offline'); }
          });
      });
      socket.on('disconnect', () => {
        joined = false;
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
      socket.on('game_state', apply);
      if (AppState.currentState === 'active') socket.connect();
    };
    void start().catch(report);
    const subscription = AppState.addEventListener('change', (state) => {
      // Only practice tables can pause; multiplayer seats keep running and fall back to timeouts.
      if (state === 'background' && latest?.game.isPractice && !['paused', 'finished'].includes(latest.game.status)) {
        void mutate(`/api/rooms/${code}/pause`, {});
      }
      if (state === 'active') {
        if (socket?.connected) void refresh();
        else socket?.connect();
      } else {
        clearTimeout(retry);
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
  }, [attempt, code]);

  return {
    snapshot, connection, error, needsLogin, busy, syncing, completedTrick,
    finishCollection,
    refresh: () => controls.current?.refresh(),
    mutate: (path: string, body: unknown) => controls.current?.mutate(path, body) ?? Promise.resolve(false),
  };
}
