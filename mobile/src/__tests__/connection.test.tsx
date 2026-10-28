import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ConnectionScreen from '@/app/connection';
import { checkBackendReadiness } from '@/lib/backend';

jest.mock('@/lib/backend', () => ({ checkBackendReadiness: jest.fn() }));
const checkReadiness = jest.mocked(checkBackendReadiness);
const originalBackendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

beforeEach(() => {
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://becca.example';
});

afterEach(() => {
  jest.resetAllMocks();
  jest.useRealTimers();
  if (originalBackendUrl === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = originalBackendUrl;
});

it('shows a connection failure and lets the user retry successfully', async () => {
  checkReadiness.mockRejectedValueOnce(new Error('Server non raggiungibile.')).mockResolvedValueOnce();

  await render(<ConnectionScreen />);
  expect(await screen.findByText('Server non raggiungibile.')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: 'Riprova' }));
  expect(await screen.findByText('Backend pronto.')).toBeOnTheScreen();
  expect(checkReadiness).toHaveBeenCalledTimes(2);
});

it('cancels the pending check when leaving the screen', async () => {
  checkReadiness.mockImplementation(() => new Promise(() => {}));

  await render(<ConnectionScreen />);
  const signal = checkReadiness.mock.calls[0][1];
  await screen.unmount();
  expect(signal.aborted).toBe(true);
});

it('ends a stalled request with an actionable timeout instead of staying loading', async () => {
  jest.useFakeTimers();
  checkReadiness.mockImplementation((_url, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }));

  await render(<ConnectionScreen />);
  await act(() => jest.advanceTimersByTime(8_000));
  expect(screen.getByRole('alert')).toHaveTextContent('Il server non ha risposto entro 8 secondi.');
  expect(screen.getByRole('button', { name: 'Riprova' })).toBeEnabled();
});

it('explains an unconfigured server without reporting a network failure or issuing a request', async () => {
  delete process.env.EXPO_PUBLIC_BACKEND_URL;

  await render(<ConnectionScreen />);

  expect(screen.getByText('Il server non è ancora configurato per questa versione dell’app.')).toBeOnTheScreen();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Riprova' })).toBeNull();
  expect(checkReadiness).not.toHaveBeenCalled();
});

it('explains a native fetch network error in Italian and keeps retry available', async () => {
  checkReadiness.mockRejectedValueOnce(new TypeError('Network request failed'));

  await render(<ConnectionScreen />);

  expect(screen.getByRole('alert')).toHaveTextContent('Non riesco a raggiungere il server. Controlla la connessione e riprova.');
  expect(screen.getByRole('button', { name: 'Riprova' })).toBeEnabled();
});
