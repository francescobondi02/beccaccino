import * as SecureStore from 'expo-secure-store';

import { clearSession, restoreSession, sessionRequest, signIn } from '../session';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
}));

const origin = 'https://becca.example';
const user = { id: 7, username: 'Socio' };
const fetchMock = jest.fn();
const saved = JSON.stringify({ origin, token: 'test-token' });
let controller: AbortController;

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  controller = new AbortController();
  jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
  jest.mocked(SecureStore.getItemAsync).mockReset().mockResolvedValue(null);
  jest.mocked(SecureStore.setItemAsync).mockReset().mockResolvedValue();
  jest.mocked(SecureStore.deleteItemAsync).mockReset().mockResolvedValue();
});

afterEach(() => jest.restoreAllMocks());

it('logs in through the native endpoint and stores only an origin-bound token securely', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user, token: 'test-token' }) });
  await expect(signIn(origin, ' Socio ', 'password', controller.signal)).resolves.toEqual(user);
  expect(fetchMock).toHaveBeenCalledWith(`${origin}/api/users/native/login`, expect.objectContaining({
    method: 'POST', credentials: 'omit', body: JSON.stringify({ username: 'Socio', password: 'password' }),
  }));
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('becca.session', saved, { keychainAccessible: 'device-only' });
});

it('does not report a successful login when secure persistence fails', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user, token: 'test-token' }) });
  jest.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error('Keychain unavailable'));
  await expect(signIn(origin, 'Socio', 'password', controller.signal)).rejects.toThrow('salvare la sessione');
});

it('reports incorrect credentials without persisting a session', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 401 });
  await expect(signIn(origin, 'Socio', 'wrong', controller.signal)).rejects.toThrow('Nome utente o password');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

it.each([
  { user, token: '' }, { user: { id: '7', username: 'Socio' }, token: 'test-token' },
])('rejects malformed login responses without saving credentials', async (body) => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => body });
  await expect(signIn(origin, 'Socio', 'password', controller.signal)).rejects.toThrow();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

it('restores a session only after verifying the account through authenticated me', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(saved);
  fetchMock.mockResolvedValue({ ok: true, json: async () => user });
  await expect(restoreSession(origin, controller.signal)).resolves.toEqual(user);
  expect(fetchMock).toHaveBeenCalledWith(`${origin}/api/users/me`, expect.objectContaining({
    credentials: 'omit', headers: { Authorization: 'Bearer test-token', Accept: 'application/json' },
  }));
});

it('never sends a saved token to another backend', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(saved);
  await expect(restoreSession('https://another.example', controller.signal)).resolves.toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});

it('deletes an expired session but preserves it on server or network failure', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(saved);
  fetchMock.mockResolvedValueOnce({ ok: false, status: 503 }).mockRejectedValueOnce(new TypeError('Network request failed'))
    .mockResolvedValueOnce({ ok: false, status: 401 });
  await expect(restoreSession(origin, controller.signal)).rejects.toThrow('server non è disponibile');
  await expect(restoreSession(origin, controller.signal)).rejects.toThrow('connessione');
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  await expect(restoreSession(origin, controller.signal)).rejects.toMatchObject({ status: 401 });
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
});

it('surfaces corrupt storage instead of silently treating it as a signed-out session', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('broken-json');
  await expect(restoreSession(origin, controller.signal)).rejects.toThrow('sessione salvata non è leggibile');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not claim logout succeeded if secure deletion fails', async () => {
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValue(new Error('Keychain locked'));
  await expect(clearSession()).rejects.toThrow('rimuovere la sessione');
});

it('aborts a stalled network request after eight seconds', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation((_url, { signal }: RequestInit) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('Aborted')));
  }));
  try {
    const result = expect(signIn(origin, 'Socio', 'password', controller.signal)).rejects.toThrow('8 secondi');
    await jest.advanceTimersByTimeAsync(8_000);
    await result;
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

it('does not send native credentials to a different request origin', async () => {
  const previous = process.env.EXPO_PUBLIC_BACKEND_URL;
  process.env.EXPO_PUBLIC_BACKEND_URL = origin;
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(saved);
  try {
    await expect(sessionRequest('https://another.example/api', controller.signal)).rejects.toThrow('backend della sessione');
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
    else process.env.EXPO_PUBLIC_BACKEND_URL = previous;
  }
});
