import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { io } from 'socket.io-client';
import GameScreen from '@/app/game/[code]';
import PlayScreen from '@/app/play';
import RoomScreen from '@/app/room/[code]';
import { readGameState } from '@/lib/game';
import { touchFeedback } from '@/lib/haptics';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ code: 'ABC123' }),
  useRouter: () => ({ replace: mockReplace, push: mockPush, navigate: jest.fn() }),
  useFocusEffect: (callback: () => (() => void) | undefined) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(callback, [callback]);
  },
}));
const signedIn = { status: 'signedIn', user: { id: 7, username: 'Socio' } };
let mockSession: { status: string; user?: { id: number; username: string } };
jest.mock('@/context/SessionContext', () => ({ useSession: () => ({ state: mockSession, retry: jest.fn() }) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn() }));
jest.mock('socket.io-client', () => ({ io: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ touchFeedback: jest.fn() }));

const seated = (userIds: number[]) => userIds.map((userId, seat) =>
  ({ userId, seat, team: seat % 2, user: { username: userId === 7 ? 'Socio' : `Bot ${seat}` } }));
const room = { id: 1, code: 'ABC123', isPractice: true, pausedAt: null, players: seated([7, 8, 9, 10]) };
const card = { suit: 'coppe', value: 're' };
const openRoom = { id: 2, code: 'XYZ789', started: false, botTier: null,
  players: [{ userId: 20, team: 0, isReady: false, user: { username: 'Gianni' } }] };
let waiting: Record<string, unknown>;
const otherCard = { suit: 'bastoni', value: 'cavallo' };
const initialGame = () => ({
  status: 'playing', isPractice: true, currentHandNumber: 1, callerUserId: 7, currentTurnUserId: 7,
  round: { id: 1, number: 1, briscola: 'coppe', cricca: false, deal: null },
  roundSummary: null, myCards: [card, otherCard], playedCards: [], lastCompletedTrick: null,
  totalPoints: { team0Points: 0, team1Points: 0, team0Figures: 0, team1Figures: 0 },
  turnTimer: { turnUserId: 7, remainingMs: 60000, totalMs: 60000 },
  playerControls: [{ userId: 7, botModel: null }], finishedGame: null,
});
let game: Record<string, unknown>;
let waitingMode = false;
let handlers: Record<string, (...args: never[]) => void>;
let notify: (event: string) => void;
let appState: (state: AppStateStatus) => void;
let socket: { connected: boolean; active: boolean; on: jest.Mock; onAny: jest.Mock; timeout: jest.Mock;
  emit: jest.Mock; connect: jest.Mock; disconnect: jest.Mock; removeAllListeners: jest.Mock };
const fetchMock = jest.fn();
const originalAppState = AppState.currentState;
const originalBackend = process.env.EXPO_PUBLIC_BACKEND_URL;
const response = (body: unknown) => ({ ok: true, json: async () => body });
const renderGame = () => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, bottom: 0, left: 0, right: 0 } }}><GameScreen /></SafeAreaProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  room.players = seated([7, 8, 9, 10]);
  mockSession = signedIn;
  waitingMode = false;
  game = initialGame();
  waiting = { id: 3, code: 'ABC123', started: false, botTier: null, players: [{ userId: 7, team: null, isReady: false, user: { username: 'Socio' } }] };
  handlers = {};
  AppState.currentState = 'active';
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://becca.example';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { appState = callback; return { remove: jest.fn() }; });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({ origin: 'https://becca.example', token: 'native-token' }));
  socket = {
    connected: false, active: true,
    on: jest.fn((event, callback) => { handlers[event] = callback; }),
    onAny: jest.fn((callback) => { notify = callback; }),
    timeout: jest.fn(() => socket),
    emit: jest.fn((_event, _payload, callback) => callback?.(null, { ok: true })),
    connect: jest.fn(() => { socket.connected = true; handlers.connect?.(); }),
    disconnect: jest.fn(() => { socket.connected = false; handlers.disconnect?.(); }),
    removeAllListeners: jest.fn(() => { handlers = {}; }),
  };
  jest.mocked(io).mockReturnValue(socket as unknown as ReturnType<typeof io>);
  fetchMock.mockReset().mockImplementation(async (url: string, options: RequestInit) => {
    if (url.endsWith('/api/rooms/available')) return response({ activeGames: [], availableRooms: [openRoom] });
    if (url.endsWith('/api/rooms/practice')) return response({ code: 'ABC123' });
    if (url.endsWith('/api/rooms/ABC123')) return response(waiting.started === false && options?.method !== 'POST' && waitingMode ? waiting : room);
    if (url.endsWith('/api/rooms') || url.endsWith('/api/rooms/join')) return response({ ...openRoom, code: 'XYZ789' });
    if (url.endsWith('/choose-team')) { (waiting.players as { team: number | null }[])[0].team = JSON.parse(String(options.body)).team; return response({}); }
    if (url.endsWith('/ready')) { (waiting.players as { isReady: boolean }[])[0].isReady = true; return response({}); }
    if (url.endsWith('/state')) return response(structuredClone(game));
    if (url.includes('playable-cards')) return response({ playableCards: [card] });
    if (url.endsWith('/pause')) { game.status = 'paused'; return response({}); }
    if (url.endsWith('/resume')) { game.status = 'playing'; return response({}); }
    if (options.method === 'POST') return response({});
    throw new Error(`Unhandled request ${url}`);
  });
  jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
});
afterEach(() => {
  jest.restoreAllMocks();
  AppState.currentState = originalAppState;
  if (originalBackend === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = originalBackend;
});

it('joins with the stored token and sends only a selected legal card, with a leader signal', async () => {
  await renderGame();
  await waitFor(() => expect(screen.getByRole('button', { name: 're di coppe' })).toBeEnabled());
  expect(io).toHaveBeenCalledWith('https://becca.example', expect.objectContaining({ auth: { token: 'native-token' } }));
  expect(screen.getByText('TOCCA A TE!')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'cavallo di bastoni' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Gioca' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'busso' }));
  expect(screen.getByRole('button', { name: 'busso' })).toBeSelected();
  await fireEvent.press(screen.getByRole('button', { name: 're di coppe' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Gioca' }));
  expect(fetchMock).toHaveBeenCalledWith('https://becca.example/api/games/play-card', expect.objectContaining({
    method: 'POST', credentials: 'omit', body: JSON.stringify({ roomCode: 'ABC123', ...card, signal: 'busso' }),
  }));
});

it('plays a selected card when it is tapped again', async () => {
  await renderGame();
  await waitFor(() => expect(screen.getByRole('button', { name: 're di coppe' })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: 're di coppe' }));
  expect(fetchMock).not.toHaveBeenCalledWith('https://becca.example/api/games/play-card', expect.anything());
  await fireEvent.press(screen.getByRole('button', { name: 're di coppe' }));
  expect(fetchMock).toHaveBeenCalledWith('https://becca.example/api/games/play-card', expect.objectContaining({
    body: JSON.stringify({ roomCode: 'ABC123', ...card, signal: null }),
  }));
});

it('previews any hand card on long press, telling whether it can be played now', async () => {
  await renderGame();
  await waitFor(() => expect(screen.getByRole('button', { name: 're di coppe' })).toBeEnabled());
  await fireEvent(screen.getByRole('button', { name: 'cavallo di bastoni' }), 'longPress');
  expect(screen.getByText('CAVALLO DI BASTONI')).toBeOnTheScreen();
  expect(screen.getByText('NON GIOCABILE ORA')).toBeOnTheScreen();
  await fireEvent(screen.getByRole('button', { name: 'cavallo di bastoni' }), 'pressOut');
  expect(screen.queryByText('CAVALLO DI BASTONI')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalledWith('https://becca.example/api/games/play-card', expect.anything());
});

it('opens the last trick from the table, laid out with the winner marked', async () => {
  game.lastCompletedTrick = { roundId: 1, handNumber: 1, winnerUserId: 8, cards: [7, 8, 9, 10].map((userId, index) => ({
    playerId: userId, userId, suit: 'spade', value: ['quattro', 'tre', 'sei', 'sette'][index], position: index, signal: null, handNumber: 1 })) };
  await renderGame();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ultima presa' })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: 'Ultima presa' }));
  expect(screen.getByRole('header', { name: 'Ultima presa' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Bot 1: tre di spade, prende')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Chiudi' }));
  expect(screen.queryByRole('header', { name: 'Ultima presa' })).toBeNull();
});

it('resynchronizes after reconnect and invalidates a selection from the previous turn', async () => {
  const view = await renderGame();
  await waitFor(() => expect(screen.getByRole('button', { name: 're di coppe' })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: 're di coppe' }));
  await act(() => socket.disconnect());
  expect(screen.getByRole('button', { name: 'Gioca' })).toBeDisabled();
  expect(screen.getByText('RICONNESSIONE…')).toBeOnTheScreen();
  game.currentTurnUserId = 8;
  await act(() => socket.connect());
  await waitFor(() => expect(screen.getByLabelText(/Bot 1, sta giocando/)).toBeOnTheScreen());
  expect(screen.queryByText('RICONNESSIONE…')).toBeNull();
  expect(screen.getByRole('button', { name: 'Gioca' })).toBeDisabled();
  expect(socket.emit).toHaveBeenCalledTimes(2);
  await view.unmount();
  expect(socket.removeAllListeners).toHaveBeenCalled();
});

it('pauses on the server before allowing exit, and resumes the same game', async () => {
  await renderGame();
  await waitFor(() => expect(screen.getByRole('button', { name: 're di coppe' })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: 'Pausa / menu' }));
  await waitFor(() => expect(screen.getByRole('header', { name: 'Allenamento in pausa' })).toBeOnTheScreen());
  expect(screen.getByRole('button', { name: 'Torna a Gioca' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Riprendi partita' }));
  await waitFor(() => expect(screen.queryByRole('header', { name: 'Allenamento in pausa' })).toBeNull());
  expect(fetchMock).toHaveBeenCalledWith('https://becca.example/api/rooms/ABC123/resume', expect.objectContaining({ method: 'POST' }));
});

it('requests pause when backgrounded and does not keep a socket alive', async () => {
  await renderGame();
  await waitFor(() => expect(screen.getByRole('button', { name: 're di coppe' })).toBeEnabled());
  await act(() => appState('background'));
  expect(socket.disconnect).toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledWith('https://becca.example/api/rooms/ABC123/pause', expect.objectContaining({ method: 'POST' }));
});

it('chooses briscola through the existing room API and shows final server scores', async () => {
  game.status = 'choosing_briscola';
  game.round = { id: 1, number: 1, briscola: null, cricca: false, deal: null };
  await renderGame();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Scegli briscola' })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: 'Scegli briscola' }));
  await fireEvent.press(screen.getByRole('button', { name: 'coppe' }));
  expect(fetchMock).toHaveBeenCalledWith('https://becca.example/api/games/choose-briscola', expect.objectContaining({
    body: JSON.stringify({ gameRoomId: 1, suit: 'coppe' }),
  }));
  game.status = 'finished';
  game.finishedGame = { winnerTeam: 0, totalRounds: 5, finalScores: { team0: 42, team1: 35 } };
  await act(() => notify('game_finished'));
  await waitFor(() => expect(screen.getByLabelText('Noi 42 punti e 0 figure, loro 35 punti e 0 figure')).toBeOnTheScreen());
  expect(screen.getByRole('header', { name: 'La partita è vostra!' })).toBeOnTheScreen();
});

it('shows scores, round summary and result from the side of a player on team 1', async () => {
  room.players = seated([8, 7, 9, 10]);
  game.status = 'choosing_briscola';
  game.round = { id: 2, number: 2, briscola: null, cricca: false, deal: { remainingMs: 10_000, animationMs: 2400, reviewMs: 1600 } };
  game.roundSummary = { roundNumber: 1, team0Points: 3, team1Points: 8, winnerTeam: 1 };
  game.totalPoints = { team0Points: 3, team1Points: 8, team0Figures: 1, team1Figures: 2 };
  await renderGame();
  await waitFor(() => expect(screen.getByText('Noi 8 · Loro 3')).toBeOnTheScreen());
  // The round summary hides the table from accessibility; the scoreboard is still drawn behind it.
  expect(screen.getByLabelText('Noi 8 punti e 2 figure, loro 3 punti e 1 figure', { includeHiddenElements: true })).toBeOnTheScreen();
  game.status = 'finished';
  game.roundSummary = null;
  game.finishedGame = { winnerTeam: 1, totalRounds: 5, finalScores: { team0: 35, team1: 42 } };
  await act(() => notify('game_finished'));
  await waitFor(() => expect(screen.getByRole('header', { name: 'La partita è vostra!' })).toBeOnTheScreen());
  expect(screen.getByLabelText('Noi 42 punti e 0 figure, loro 35 punti e 0 figure')).toBeOnTheScreen();
  expect(touchFeedback).toHaveBeenCalledWith('success');
});

const renderScreen = (node: React.ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>{node}</SafeAreaProvider>);

it('creates a real practice game once even if the start button is tapped twice', async () => {
  const implementation = fetchMock.getMockImplementation()!;
  let finish!: () => void;
  fetchMock.mockImplementation((url, options) => url.endsWith('/api/rooms/practice')
    ? new Promise((resolve) => { finish = () => resolve(response({ code: 'ABC123' })); })
    : implementation(url, options));
  await renderScreen(<PlayScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Gioca contro i bot' })).toBeEnabled());
  const button = screen.getByRole('button', { name: 'Gioca contro i bot' });
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/api/rooms/practice'))).toHaveLength(1);
  await act(() => finish());
  expect(mockPush).toHaveBeenCalledWith('/game/ABC123');
});

it('lists open rooms live and joins one, by tap or by code', async () => {
  await renderScreen(<PlayScreen />);
  const openCard = await screen.findByRole('button', { name: 'Entra XYZ789, 1 su 4: Gianni' });
  expect(socket.emit).toHaveBeenCalledWith('join_lobby');
  await fireEvent.press(openCard);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/room/XYZ789'));
  expect(fetchMock).toHaveBeenCalledWith('https://becca.example/api/rooms/join', expect.objectContaining({ body: JSON.stringify({ roomCode: 'XYZ789' }) }));
  await fireEvent.changeText(screen.getByLabelText('Codice stanza'), 'xyz-789');
  expect(screen.getByLabelText('Codice stanza')).toHaveDisplayValue('XYZ789');
  await fireEvent.press(screen.getByRole('button', { name: 'Entra' }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));
});

it('opens the lobby socket only once signed in', async () => {
  mockSession = { status: 'signedOut' };
  const view = await renderScreen(<PlayScreen />);
  expect(screen.getByRole('button', { name: 'Accedi per giocare' })).toBeOnTheScreen();
  expect(io).not.toHaveBeenCalled();
  mockSession = signedIn;
  await view.rerender(<SafeAreaProvider><PlayScreen /></SafeAreaProvider>);
  await screen.findByRole('button', { name: 'Entra XYZ789, 1 su 4: Gianni' });
  expect(socket.emit).toHaveBeenCalledWith('join_lobby');
});

it('retries the lobby socket after a non-authentication middleware rejection', async () => {
  await renderScreen(<PlayScreen />);
  await screen.findByRole('button', { name: 'Entra XYZ789, 1 su 4: Gianni' });
  jest.useFakeTimers();
  try {
    socket.connect.mockClear();
    socket.active = false;
    await act(() => (handlers.connect_error as (cause: Error) => void)(new Error('Authentication unavailable')));
    expect(socket.connect).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(5000));
    expect(socket.connect).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

// The first request answers last with stale data; only the newer response may be shown.
const answerFirstRequestLast = (path: string, stale: unknown) => {
  const implementation = fetchMock.getMockImplementation()!;
  let finish!: () => void;
  fetchMock.mockImplementationOnce((url: string) => {
    if (!url.endsWith(path)) throw new Error(`Unexpected first request ${url}`);
    return new Promise((resolve) => { finish = () => resolve(response(stale)); });
  }).mockImplementation(implementation);
  return () => finish();
};

it('ignores an older lobby response that arrives after a newer one', async () => {
  const finishStale = answerFirstRequestLast('/api/rooms/available', { activeGames: [], availableRooms: [] });
  await renderScreen(<PlayScreen />);
  await screen.findByRole('button', { name: 'Entra XYZ789, 1 su 4: Gianni' });
  await act(() => finishStale());
  expect(screen.getByRole('button', { name: 'Entra XYZ789, 1 su 4: Gianni' })).toBeOnTheScreen();
});

it('ignores an older waiting-room response that arrives after a newer one', async () => {
  waitingMode = true;
  const finishStale = answerFirstRequestLast('/api/rooms/ABC123', { ...waiting, botTier: 'facile' });
  await renderScreen(<RoomScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Nessuno' })).toBeSelected());
  await act(() => finishStale());
  expect(screen.getByRole('button', { name: 'Nessuno' })).toBeSelected();
});

it('seats the player, marks ready and opens the table when the game starts', async () => {
  waitingMode = true;
  await renderScreen(<RoomScreen />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Siediti nella squadra B' })).toHaveLength(2));
  await fireEvent.press(screen.getAllByRole('button', { name: 'Siediti nella squadra B' })[0]);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://becca.example/api/rooms/ABC123/choose-team',
    expect.objectContaining({ body: JSON.stringify({ team: 1 }) })));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sono pronto' })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: 'Sono pronto' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Non sono pronto' })).toBeOnTheScreen());
  expect(socket.emit).toHaveBeenCalledWith('join_room', { roomCode: 'ABC123', userId: 7, username: 'Socio' });
  await act(() => notify('game_started'));
  expect(mockReplace).toHaveBeenCalledWith('/game/ABC123');
});

it('waits for bots to fill the table instead of timing out the ready request', async () => {
  waitingMode = true;
  (waiting.players as { team: number | null }[])[0].team = 0;
  const implementation = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, options: RequestInit) => url.endsWith('/ready')
    ? new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    : implementation(url, options));
  await renderScreen(<RoomScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sono pronto' })).toBeEnabled());
  jest.useFakeTimers();
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'Sono pronto' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://becca.example/api/rooms/ABC123/ready', expect.anything()));
    await act(async () => { jest.advanceTimersByTime(60_000); });
    // Still waiting on the server: the button must not re-enable and invite a second, toggling tap.
    expect(screen.getByRole('button', { name: 'Sono pronto' })).toBeDisabled();
  } finally { jest.useRealTimers(); }
});

it('fails explicitly on an incompatible server instead of inventing a completed trick', () => {
  delete game.lastCompletedTrick;
  expect(() => readGameState(game)).toThrow();
});

it('offers login recovery when authentication expires during a game', async () => {
  await renderGame();
  await waitFor(() => expect(screen.getByRole('button', { name: 're di coppe' })).toBeEnabled());
  fetchMock.mockResolvedValue({ ok: false, status: 401 });
  await act(() => notify('turn_timer_started'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Accedi di nuovo' })).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole('button', { name: 'Accedi di nuovo' }));
  expect(mockReplace).toHaveBeenCalledWith('/account');
});

it('retries initial secure-storage failures instead of leaving a dead retry button', async () => {
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('Keychain unavailable'));
  await renderGame();
  await waitFor(() => expect(screen.getByText(/Non riesco a leggere la sessione/)).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole('button', { name: 'Riprova' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 're di coppe' })).toBeEnabled());
});

it('coalesces related socket notifications and disables actions until the new snapshot arrives', async () => {
  await renderGame();
  await waitFor(() => expect(screen.getByRole('button', { name: 're di coppe' })).toBeEnabled());
  const reads = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/state')).length;
  const before = reads();
  await act(() => { notify('card_played'); notify('turn_timer_started'); notify('player_control_changed'); });
  expect(screen.getByRole('button', { name: 're di coppe' })).toBeDisabled();
  await waitFor(() => expect(screen.getByRole('button', { name: 're di coppe' })).toBeEnabled());
  expect(reads() - before).toBe(1);
});
