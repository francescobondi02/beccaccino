import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Socket } from 'socket.io-client';
import { authFailures, openSocket } from '@/lib/socket';

// Keeps a lobby or waiting-room screen live: joins the socket room, then reloads REST state whenever one of
// `events` arrives (coalesced). REST stays the source of truth; the socket only says "something changed".
export default function useSocketRefresh(join: (socket: Socket) => void, events: readonly string[],
  refresh: () => void, onEvent?: (event: string) => void) {
  const [online, setOnline] = useState(false);
  const [expired, setExpired] = useState(false);
  const latest = useRef({ join, events, refresh, onEvent });
  useEffect(() => { latest.current = { join, events, refresh, onEvent }; });
  useEffect(() => {
    let socket: Socket | null = null;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => { clearTimeout(timer); timer = setTimeout(() => latest.current.refresh(), 150); };
    void openSocket().then((created) => {
      if (!active) return;
      socket = created;
      socket.on('connect', () => { setOnline(true); latest.current.join(created); reload(); });
      socket.on('disconnect', () => setOnline(false));
      socket.on('connect_error', (cause: Error) => {
        setOnline(false);
        if (authFailures.includes(cause.message)) { setExpired(true); created.disconnect(); }
      });
      socket.onAny((event: string) => {
        if (!latest.current.events.includes(event)) return;
        latest.current.onEvent?.(event);
        reload();
      });
      if (AppState.currentState === 'active') socket.connect();
    }).catch(() => { if (active) setExpired(true); });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') socket?.connect();
      else socket?.disconnect();
    });
    return () => {
      active = false;
      clearTimeout(timer);
      subscription.remove();
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, []);
  return { online, expired };
}
