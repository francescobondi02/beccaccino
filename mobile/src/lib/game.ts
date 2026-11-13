import type { Card, Suit } from '@contract/cards';
import type { GamePlayer, GameState } from '@contract/game';

export const suits = ['denara', 'coppe', 'spade', 'bastoni'] as const satisfies readonly Suit[];
export const signals = ['striscio', 'busso', 'volo'] as const;
export const signalIcons = { striscio: '⚡', busso: '✊', volo: '🕊️' } as const;
export type Trick = NonNullable<GameState['lastTrick']>;

// Bot accounts carry a " (bot)" suffix; the app shows a BOT tag instead.
export const displayName = (username: string) => username.replace(/\s*\(bot\)$/i, '');
export function cardKey(card: Card): string { return `${card.value}_${card.suit}`; }
export function cardLabel(card: Card): string { return `${card.value} di ${card.suit}`; }
const seatOf = (players: GamePlayer[], userId: number) => players.find((p) => p.userId === userId)?.seat ?? 0;
// Where a player sits as seen by the viewer: 0 left, 1 partner opposite, 2 right, 3 the viewer.
export function relativeSeat(players: GamePlayer[], userId: number, viewerId: number): number {
  return ((seatOf(players, userId) - seatOf(players, viewerId) + 4) % 4 + 3) % 4;
}
export function teamOf(players: GamePlayer[], userId: number): number {
  return players.find((p) => p.userId === userId)?.team ?? 0;
}
// The server reports team 0 and team 1; the table always shows [ours, theirs].
export function ourSide<T>(players: GamePlayer[], viewerId: number, team0: T, team1: T): [T, T] {
  return teamOf(players, viewerId) === 1 ? [team1, team0] : [team0, team1];
}
// Starting a table may wait for the bot service to wake up (up to ~75 s on the server).
export const botStartTimeoutMs = 90_000;
export const botTiers = ['facile', 'medio', 'forte', 'esperto'] as const;
