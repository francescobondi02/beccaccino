export const suits = ['denara', 'coppe', 'spade', 'bastoni'] as const;
export const values = ['asso', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'fante', 'cavallo', 're'] as const;
export const signals = ['striscio', 'busso', 'volo'] as const;
export const signalIcons = { striscio: '⚡', busso: '✊', volo: '🕊️' } as const;
export type Suit = typeof suits[number];
export type Card = { suit: Suit; value: typeof values[number] };
export type Signal = typeof signals[number];
export type PlayedCard = Card & { userId: number; position: number; signal: Signal | null };
export type Trick = { roundId: number; handNumber: number; winnerUserId: number; cards: PlayedCard[] };
export type Room = {
  id: number; code: string; isPractice: boolean; pausedAt: string | null;
  players: { userId: number; username: string; seat: number; team: number }[];
};
export type GameState = {
  status: 'choosing_briscola' | 'playing' | 'paused' | 'finished';
  round: { id: number; number: number; briscola: Suit | null; cricca: boolean;
    deal: { remainingMs: number; animationMs: number; reviewMs: number } | null };
  roundSummary: { roundNumber: number; team0Points: number; team1Points: number; winnerTeam: number } | null;
  currentHandNumber: number | null; callerUserId: number | null; currentTurnUserId: number | null;
  myCards: Card[]; playedCards: PlayedCard[]; lastCompletedTrick: Trick | null;
  totalPoints: { team0Points: number; team1Points: number; team0Figures: number; team1Figures: number };
  turnTimer: { turnUserId: number; remainingMs: number; totalMs: number | null } | null;
  playerControls: { userId: number; botModel: string | null }[];
  finishedGame: { winnerTeam: number; totalRounds: number; finalScores: { team0: number; team1: number } } | null;
};

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Risposta del server non valida.');
  return value as Record<string, unknown>;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error('Valore del server non valido.');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Testo del server non valido.');
  return value;
}
function member<T extends string>(value: unknown, options: readonly T[]): T {
  const found = options.find((option) => option === value);
  if (found === undefined) throw new Error('Stato del server non riconosciuto.');
  return found;
}
function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('Elenco del server non valido.');
  return value.map(parse);
}
function nullable<T>(value: unknown, parse: (item: unknown) => T): T | null {
  return value === null ? null : parse(value);
}
const displayName = (user: unknown) => text(record(user).username).replace(/\s*\(bot\)$/i, '');
export function cardKey(card: Card): string { return `${card.value}_${card.suit}`; }
export function cardLabel(card: Card): string { return `${card.value} di ${card.suit}`; }
const seatOf = (room: Room, userId: number) => room.players.find((p) => p.userId === userId)?.seat ?? 0;
// Where a player sits as seen by the viewer: 0 left, 1 partner opposite, 2 right, 3 the viewer.
export function relativeSeat(room: Room, userId: number, viewerId: number): number {
  return ((seatOf(room, userId) - seatOf(room, viewerId) + 4) % 4 + 3) % 4;
}
export function teamOf(room: Room, userId: number): number {
  return room.players.find((p) => p.userId === userId)?.team ?? 0;
}
// The server reports team 0 and team 1; the table always shows [ours, theirs].
export function ourSide<T>(room: Room, viewerId: number, team0: T, team1: T): [T, T] {
  return teamOf(room, viewerId) === 1 ? [team1, team0] : [team0, team1];
}
export function readCard(value: unknown): Card {
  const data = record(value);
  return { suit: member(data.suit, suits), value: member(data.value, values) };
}
function readPlayedCard(value: unknown): PlayedCard {
  const data = record(value);
  return { ...readCard(data), userId: integer(data.userId), position: integer(data.position),
    signal: nullable(data.signal, (signal) => member(signal, signals)) };
}
export function readPlayable(value: unknown): Card[] {
  return array(record(value).playableCards, readCard);
}
export function readRoomCode(value: unknown): string {
  const code = text(record(value).code);
  if (!/^[A-Za-z0-9]{6,12}$/.test(code)) throw new Error('Codice stanza non valido.');
  return code;
}
export function readRoom(value: unknown): Room {
  const data = record(value);
  const players = array(data.players, (value) => {
    const player = record(value);
    const seat = integer(player.seat);
    const team = integer(player.team);
    if (seat > 3 || team > 1) throw new Error('Posti al tavolo non validi.');
    // Bot accounts carry a " (bot)" suffix; the table shows a BOT tag instead.
    return { userId: integer(player.userId), username: displayName(player.user), seat, team };
  });
  if (players.length !== 4 || new Set(players.map((p) => p.seat)).size !== 4 || typeof data.isPractice !== 'boolean') {
    throw new Error('La stanza non contiene quattro giocatori.');
  }
  return { id: integer(data.id), code: readRoomCode(data), isPractice: data.isPractice,
    pausedAt: nullable(data.pausedAt, text), players };
}
// Starting a table may wait for the bot service to wake up (up to ~75 s on the server).
export const botStartTimeoutMs = 90_000;
export const botTiers = ['facile', 'medio', 'forte', 'esperto'] as const;
export type BotTier = typeof botTiers[number];
export type WaitingPlayer = { userId: number; username: string; team: number | null; isReady: boolean };
export type WaitingRoom = { id: number; code: string; started: boolean; botTier: BotTier | null; players: WaitingPlayer[] };
export type Lobby = { practice: Room | null; games: WaitingRoom[]; open: WaitingRoom[] };

// Rooms before the deal: seats and teams may still be empty.
export function readWaitingRoom(value: unknown): WaitingRoom {
  const data = record(value);
  const players = array(data.players, (value) => {
    const player = record(value);
    const team = nullable(player.team ?? null, integer);
    if (team !== null && team > 1) throw new Error('Squadra non valida.');
    return { userId: integer(player.userId), username: displayName(player.user), team, isReady: player.isReady === true };
  });
  if (players.length > 4) throw new Error('La stanza ha troppi giocatori.');
  return { id: integer(data.id), code: readRoomCode(data), started: data.started === true,
    botTier: nullable(data.botTier ?? null, (tier) => member(tier, botTiers)), players };
}
export function readLobby(value: unknown): Lobby {
  const data = record(value);
  const active = array(data.activeGames, record);
  const practice = active.find((room) => room.isPractice === true);
  return { practice: practice ? readRoom(practice) : null,
    games: active.filter((room) => room.isPractice !== true).map(readWaitingRoom),
    open: array(data.availableRooms, readWaitingRoom) };
}
export function readGameState(value: unknown): GameState {
  const data = record(value);
  const round = record(data.round);
  const score = record(data.totalPoints);
  return {
    status: member(data.status, ['choosing_briscola', 'playing', 'paused', 'finished']),
    round: {
      id: integer(round.id), number: integer(round.number), briscola: nullable(round.briscola, (suit) => member(suit, suits)),
      cricca: round.cricca === true,
      deal: nullable(round.deal, (value) => {
        const deal = record(value);
        return { remainingMs: integer(deal.remainingMs), animationMs: integer(deal.animationMs), reviewMs: integer(deal.reviewMs) };
      }),
    },
    roundSummary: nullable(data.roundSummary, (value) => {
      const summary = record(value);
      return { roundNumber: integer(summary.roundNumber), winnerTeam: integer(summary.winnerTeam),
        team0Points: integer(summary.team0Points), team1Points: integer(summary.team1Points) };
    }),
    currentHandNumber: nullable(data.currentHandNumber, integer),
    callerUserId: nullable(data.callerUserId, integer), currentTurnUserId: nullable(data.currentTurnUserId, integer),
    myCards: array(data.myCards, readCard), playedCards: array(data.playedCards, readPlayedCard),
    lastCompletedTrick: nullable(data.lastCompletedTrick, (value) => {
      const trick = record(value);
      const cards = array(trick.cards, readPlayedCard);
      if (cards.length !== 4) throw new Error('Presa incompleta ricevuta dal server.');
      return { roundId: integer(trick.roundId), handNumber: integer(trick.handNumber),
        winnerUserId: integer(trick.winnerUserId), cards };
    }),
    totalPoints: { team0Points: integer(score.team0Points), team1Points: integer(score.team1Points),
      team0Figures: integer(score.team0Figures), team1Figures: integer(score.team1Figures) },
    turnTimer: nullable(data.turnTimer, (value) => {
      const timer = record(value);
      return { turnUserId: integer(timer.turnUserId), remainingMs: integer(timer.remainingMs), totalMs: nullable(timer.totalMs, integer) };
    }),
    playerControls: array(data.playerControls, (value) => {
      const player = record(value);
      return { userId: integer(player.userId), botModel: nullable(player.botModel, text) };
    }),
    finishedGame: nullable(data.finishedGame, (value) => {
      const result = record(value);
      const scores = record(result.finalScores);
      return { winnerTeam: integer(result.winnerTeam), totalRounds: integer(result.totalRounds),
        finalScores: { team0: integer(scores.team0), team1: integer(scores.team1) } };
    }),
  };
}
