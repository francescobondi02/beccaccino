import * as SecureStore from 'expo-secure-store';

import { backendOrigin } from '@/lib/backend';

export type SessionUser = { id: number; username: string };
const storageKey = 'becca.session';

export class SessionHttpError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? 'Accesso non valido.'
      : status === 429 ? 'Troppi tentativi. Attendi prima di riprovare.'
        : status >= 500 ? 'Il server non è disponibile. Riprova tra poco.'
          : `Richiesta non riuscita (HTTP ${status}).`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readUser(value: unknown): SessionUser {
  if (!isRecord(value) || !Number.isInteger(value.id) || typeof value.id !== 'number' || value.id < 1 ||
    typeof value.username !== 'string' || !value.username.trim()) {
    throw new Error('Il server ha restituito un account non valido.');
  }
  return { id: value.id, username: value.username };
}

async function request(origin: string, path: string, signal: AbortSignal, options: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel);
  if (signal.aborted) cancel();
  const timeout = setTimeout(cancel, 8_000);
  try {
    const response = await fetch(new URL(path, origin).toString(), {
      ...options, credentials: 'omit', cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) throw new SessionHttpError(response.status);
    try {
      return await response.json();
    } catch (cause) {
      throw new Error('Il server ha restituito una risposta non leggibile.', { cause });
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Il server non ha risposto entro 8 secondi.');
    if (error instanceof TypeError) throw new Error('Non riesco a raggiungere il server. Controlla la connessione e riprova.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(storageKey);
  } catch (cause) {
    throw new Error('Non riesco a rimuovere la sessione dal dispositivo. Riprova.', { cause });
  }
}

export async function signIn(
  backendUrl: string | undefined, username: string, password: string, signal: AbortSignal,
): Promise<SessionUser> {
  const origin = backendOrigin(backendUrl).origin;
  let body: unknown;
  try {
    body = await request(origin, '/api/users/native/login', signal, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });
  } catch (error) {
    if (error instanceof SessionHttpError && error.status === 401) throw new Error('Nome utente o password non corretti.');
    throw error;
  }
  if (!isRecord(body) || typeof body.token !== 'string' || !/^\S+$/.test(body.token)) {
    throw new Error('Il server non ha restituito una sessione valida.');
  }
  const user = readUser(body.user);
  if (signal.aborted) throw new Error('Accesso interrotto.');
  try {
    await SecureStore.setItemAsync(storageKey, JSON.stringify({ origin, token: body.token }), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (cause) {
    throw new Error('Non riesco a salvare la sessione in modo sicuro. Riprova.', { cause });
  }
  return user;
}

export async function restoreSession(backendUrl: string | undefined, signal: AbortSignal): Promise<SessionUser | null> {
  const origin = backendOrigin(backendUrl).origin;
  let value: string | null;
  try {
    value = await SecureStore.getItemAsync(storageKey);
  } catch (cause) {
    throw new Error('Non riesco a leggere la sessione salvata. Riprova o rimuovila dal dispositivo.', { cause });
  }
  if (value === null) return null;
  let saved: unknown;
  try {
    saved = JSON.parse(value);
  } catch (cause) {
    throw new Error('La sessione salvata non è leggibile. Rimuovila e accedi di nuovo.', { cause });
  }
  if (!isRecord(saved) || typeof saved.origin !== 'string' || typeof saved.token !== 'string' || !/^\S+$/.test(saved.token)) {
    throw new Error('La sessione salvata non è valida. Rimuovila e accedi di nuovo.');
  }
  if (saved.origin !== origin) return null;
  try {
    return readUser(await request(origin, '/api/users/me', signal, {
      headers: { Authorization: `Bearer ${saved.token}`, Accept: 'application/json' },
    }));
  } catch (error) {
    if (error instanceof SessionHttpError && error.status === 401) await clearSession();
    throw error;
  }
}
