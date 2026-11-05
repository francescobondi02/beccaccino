import { readGameState, readLobby, readRoom, readWaitingRoom } from '../game';

const player = (userId: number, seat: number, username = `Giocatore ${userId}`) =>
  ({ userId, seat, team: seat % 2, user: { username } });
const room = (overrides = {}) => ({ id: 1, code: 'ABC123', isPractice: false, pausedAt: null,
  players: [player(7, 0, 'Socio'), player(8, 1, 'Forte (bot)'), player(9, 2), player(10, 3)], ...overrides });

it('reads a seated room, showing bots without their account suffix', () => {
  expect(readRoom(room()).players.map((p) => p.username)).toEqual(['Socio', 'Forte', 'Giocatore 9', 'Giocatore 10']);
});

it('rejects a table with a duplicate or missing seat', () => {
  expect(() => readRoom(room({ players: [player(7, 0), player(8, 1), player(9, 1), player(10, 3)] }))).toThrow('quattro giocatori');
  expect(() => readRoom(room({ players: [player(7, 0), player(8, 1), player(9, 2)] }))).toThrow('quattro giocatori');
});

it('reads a waiting room where teams and ready flags may still be missing', () => {
  expect(readWaitingRoom({ id: 3, code: 'XYZ789', players: [{ userId: 7, user: { username: 'Medio (bot)' } }] })).toEqual({
    id: 3, code: 'XYZ789', started: false, botTier: null,
    players: [{ userId: 7, username: 'Medio', team: null, isReady: false }],
  });
  expect(() => readWaitingRoom({ id: 3, code: 'XYZ789', players: [{ userId: 7, team: 2, user: { username: 'Socio' } }] })).toThrow();
});

it('splits my practice table from my multiplayer rooms, started or not', () => {
  const lobby = readLobby({
    activeGames: [
      room({ isPractice: true, started: true }),
      room({ code: 'LIVE01', started: true }),
      { id: 4, code: 'WAIT01', isPractice: false, started: false, players: [{ userId: 7, user: { username: 'Socio' } }] },
    ],
    availableRooms: [{ id: 5, code: 'OPEN01', started: false, players: [] }],
  });
  expect(lobby.practice?.code).toBe('ABC123');
  expect(lobby.games.map((game) => [game.code, game.started])).toEqual([['LIVE01', true], ['WAIT01', false]]);
  expect(lobby.open.map((open) => open.code)).toEqual(['OPEN01']);
});

it('fails explicitly on an incompatible server instead of inventing a completed trick', () => {
  const game = {
    status: 'playing', currentHandNumber: 1, callerUserId: 7, currentTurnUserId: 7,
    round: { id: 1, number: 1, briscola: 'coppe', cricca: false, deal: null }, roundSummary: null,
    myCards: [], playedCards: [], totalPoints: { team0Points: 0, team1Points: 0, team0Figures: 0, team1Figures: 0 },
    turnTimer: null, playerControls: [], finishedGame: null,
  };
  expect(() => readGameState(game)).toThrow();
  expect(readGameState({ ...game, lastCompletedTrick: null }).lastCompletedTrick).toBeNull();
});
