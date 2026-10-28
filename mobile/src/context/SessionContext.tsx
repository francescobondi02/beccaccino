import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { clearSession, restoreSession, SessionHttpError, signIn, type SessionUser } from '@/lib/session';

type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; message?: string }
  | { status: 'signedIn'; user: SessionUser; message?: string }
  | { status: 'error'; message: string };

type SessionContextValue = {
  state: SessionState;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<boolean>;
  retry: () => void;
};
const SessionContext = createContext<SessionContextValue | null>(null);

function restoreFailure(error: unknown): SessionState {
  return error instanceof SessionHttpError && error.status === 401
    ? { status: 'signedOut', message: 'La sessione è scaduta. Accedi di nuovo.' }
    : { status: 'error', message: error instanceof Error ? error.message : 'Impossibile ripristinare la sessione.' };
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const pending = useRef<AbortController | null>(null);
  const perform = useCallback((
    action: (signal: AbortSignal) => Promise<SessionState>,
    failure: (error: unknown) => SessionState,
  ): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false);
    const controller = new AbortController();
    pending.current = controller;
    return action(controller.signal).then((next) => {
      if (pending.current !== controller) return false;
      setState(next);
      return true;
    }, (error: unknown) => {
      if (pending.current === controller) setState(failure(error));
      return false;
    }).finally(() => {
      if (pending.current === controller) pending.current = null;
    });
  }, []);

  const restore = useCallback(async (signal: AbortSignal): Promise<SessionState> => {
    const user = await restoreSession(process.env.EXPO_PUBLIC_BACKEND_URL, signal);
    return user ? { status: 'signedIn', user } : { status: 'signedOut' };
  }, []);
  const retry = useCallback(() => {
    if (pending.current) return;
    setState({ status: 'loading' });
    void perform(restore, restoreFailure);
  }, [perform, restore]);

  useEffect(() => {
    void perform(restore, restoreFailure);
    return () => {
      const controller = pending.current;
      pending.current = null;
      controller?.abort();
    };
  }, [perform, restore]);

  useEffect(() => {
    if (state.status !== 'signedIn') return;
    const subscription = AppState.addEventListener('change', (value) => {
      if (value === 'active') retry();
    });
    return () => subscription.remove();
  }, [retry, state.status]);

  const login = async (username: string, password: string) => {
    if (pending.current) return false;
    setState({ status: 'loading' });
    return perform(async (signal) => ({
      status: 'signedIn', user: await signIn(process.env.EXPO_PUBLIC_BACKEND_URL, username, password, signal),
    }), (error) => ({
      status: 'signedOut', message: error instanceof Error ? error.message : 'Impossibile accedere.',
    }));
  };
  const logout = async () => {
    if (pending.current) return false;
    const previous = state;
    setState({ status: 'loading' });
    return perform(async () => {
      await clearSession();
      return { status: 'signedOut' };
    }, (error) => {
      const message = error instanceof Error ? error.message : 'Impossibile uscire.';
      return previous.status === 'signedIn' ? { ...previous, message } : { status: 'error', message };
    });
  };

  return <SessionContext value={{ state, login, logout, retry }}>{children}</SessionContext>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession requires SessionProvider.');
  return session;
}
