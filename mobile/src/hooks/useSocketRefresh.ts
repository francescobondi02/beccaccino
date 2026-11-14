import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Socket } from 'socket.io-client';
import { authFailures, openSocket } from '@/lib/socket';

// Keeps a lobby or waiting-room screen live: joins the socket room, then reloads REST state whenever one of
// `event` arrives (coalesced). REST stays the source of truth; the socket only says "something changed".
export default function useSocketRefresh(join: (socket: Socket) => void, event: 'room_changed' | 'lobby_changed', refresh: () => void) {
  const [online, setOnline] = useState(false);
  const latest = useRef({ join, refresh });
  useEffect(() => { latest.current = { join, refresh }; });
  useEffect(() => {
    let socket: Socket | null = null;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const reload = () => { clearTimeout(timer); timer = setTimeout(() => latest.current.refresh(), 150); };
    void openSocket().then((created) => {
      if (!active) return;
      socket = created;
      socket.on('connect', () => { setOnline(true); latest.current.join(created); reload(); });
      socket.on('disconnect', () => setOnline(false));
      socket.on('connect_error', (cause: Error) => {
        setOnline(false);
        if (authFailures.includes(cause.message)) created.disconnect();
        // Middleware rejections stop Socket.IO's own reconnection; try again later.
        else if (!created.active) { clearTimeout(retry); retry = setTimeout(() => created.connect(), 5000); }
      });
      socket.on(event, reload);
      if (AppState.currentState === 'active') socket.connect();
    }).catch(() => {});
    const subscription = AppState.addEventListener('change', (state) => {
      clearTimeout(retry);
      if (state === 'active') socket?.connect();
      else socket?.disconnect();
    });
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(retry);
      subscription.remove();
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [event]);
  return { online };
}
