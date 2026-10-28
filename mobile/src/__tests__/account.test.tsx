import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AccountScreen from '@/app/account';
import { SessionProvider } from '@/context/SessionContext';

jest.mock('expo-router', () => ({ useRouter: () => ({ canGoBack: () => false, replace: jest.fn() }) }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
}));

const originalBackendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
const user = { id: 7, username: 'Socio' };
const saved = JSON.stringify({ origin: 'https://becca.example', token: 'test-token' });
const fetchMock = jest.fn();
const renderAccount = () => render(
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, bottom: 21, left: 44, right: 44 } }}>
    <SessionProvider><AccountScreen /></SessionProvider>
  </SafeAreaProvider>,
);

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://becca.example';
  jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
  jest.mocked(SecureStore.getItemAsync).mockReset().mockResolvedValue(null);
  jest.mocked(SecureStore.setItemAsync).mockReset().mockResolvedValue();
  jest.mocked(SecureStore.deleteItemAsync).mockReset().mockResolvedValue();
});

afterEach(() => {
  if (originalBackendUrl === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = originalBackendUrl;
  jest.restoreAllMocks();
});

it('requires credentials, conceals the password, and waits for secure storage before showing success', async () => {
  let finishSave!: () => void;
  jest.mocked(SecureStore.setItemAsync).mockReturnValue(new Promise((resolve) => { finishSave = resolve; }));
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user, token: 'test-token' }) });
  await renderAccount();
  expect(screen.getByRole('button', { name: 'Accedi' })).toBeDisabled();
  expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
  await fireEvent.press(screen.getByRole('button', { name: 'Mostra password' }));
  expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', false);
  await fireEvent.changeText(screen.getByLabelText('Nome utente'), 'Socio');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'password');
  await fireEvent.press(screen.getByRole('button', { name: 'Accedi' }));
  expect(screen.getByRole('progressbar')).toBeBusy();
  expect(screen.queryByText('Sei dentro, Socio.')).toBeNull();
  await act(() => finishSave());
  expect(screen.getByText('Sei dentro, Socio.')).toBeOnTheScreen();
});

it('shows incorrect credentials without pretending the session is authenticated', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 401 });
  await renderAccount();
  await fireEvent.changeText(screen.getByLabelText('Nome utente'), 'Socio');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong');
  await fireEvent.press(screen.getByRole('button', { name: 'Accedi' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Nome utente o password non corretti.');
  expect(screen.getByLabelText('Password')).toHaveProp('value', '');
  expect(screen.queryByRole('button', { name: 'Esci dall’account' })).toBeNull();
});

it('restores a verified account, preserves it on logout failure, and allows retrying logout', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(saved);
  fetchMock.mockResolvedValue({ ok: true, json: async () => user });
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Keychain locked'));
  await renderAccount();
  expect(screen.getByText('Sei dentro, Socio.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Esci dall’account' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/rimuovere la sessione/);
  expect(screen.getByText('Sei dentro, Socio.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Esci dall’account' }));
  expect(screen.getByRole('button', { name: 'Accedi' })).toBeDisabled();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
});

it('expires invalid sessions and revalidates the account when the app returns to the foreground', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(saved);
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => user }).mockResolvedValueOnce({ ok: false, status: 401 });
  const listener = jest.spyOn(AppState, 'addEventListener');
  await renderAccount();
  const changeState = listener.mock.calls.find(([event]) => event === 'change')?.[1];
  if (!changeState) throw new Error('Session resume listener missing');
  await act(() => changeState('active'));
  expect(screen.getByRole('alert')).toHaveTextContent(/La sessione è scaduta/);
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Accedi' })).toBeOnTheScreen();
});

it('keeps saved credentials on network failure and supports explicit restoration retry', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(saved);
  fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable')).mockResolvedValueOnce({ ok: true, json: async () => user });
  await renderAccount();
  expect(screen.getByRole('alert')).toHaveTextContent(/connessione/);
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Riprova il collegamento' }));
  expect(screen.getByText('Sei dentro, Socio.')).toBeOnTheScreen();
});

it('aborts restoration on unmount and ignores a late network response', async () => {
  let finish!: (value: unknown) => void;
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(saved);
  fetchMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const app = await renderAccount();
  const signal: AbortSignal = fetchMock.mock.calls[0][1].signal;
  await app.unmount();
  expect(signal.aborted).toBe(true);
  await act(() => finish({ ok: true, json: async () => user }));
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

it('surfaces a secure-storage read failure and supports explicitly removing the saved session', async () => {
  jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('Keychain unavailable'));
  await renderAccount();
  expect(screen.getByRole('alert')).toHaveTextContent(/leggere la sessione salvata/);
  expect(fetchMock).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Rimuovi la sessione salvata' }));
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Accedi' })).toBeDisabled();
});
