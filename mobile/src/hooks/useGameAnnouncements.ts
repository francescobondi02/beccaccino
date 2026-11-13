import { useCallback, useState } from 'react';
import type { GameState } from '@contract/game';
import { displayName, signalIcons, type Trick } from '@/lib/game';

export type Tone = 'hot' | 'info' | 'signal';
export type Announcement = { id: number; text: string; tone: Tone };

function events(game: GameState, completedTrick: Trick | null, userId: number): [string, string, Tone][] {
  const { round, trick, players } = game;
  const name = (id: number | undefined) => displayName(players.find((p) => p.userId === id)?.username ?? '').toUpperCase();
  const myTeam = players.find((p) => p.userId === userId)?.team;
  const mine = !players.some((p) => p.userId === userId && p.botModel !== null);
  const leader = trick?.cards[0];
  const list: [string, string, Tone][] = [[`round:${round.number}`, `MANO ${round.number}`, 'info']];
  if (round.briscola) list.push([`trump:${round.number}`, `BRISCOLA: ${round.briscola.toUpperCase()}`, 'hot']);
  if (completedTrick) {
    const winner = players.find((p) => p.userId === completedTrick.winnerUserId);
    list.push([`trick:${completedTrick.roundNumber}:${completedTrick.trickNumber}`,
      winner?.userId === userId ? 'PRESA TUA!' : winner?.team === myTeam ? 'PRESA DEL SOCIO!' : `PRESA A ${name(winner?.userId)}`,
      winner?.team === myTeam ? 'hot' : 'info']);
  }
  if (leader?.signal) {
    list.push([`signal:${round.number}:${trick?.number}`,
      `${signalIcons[leader.signal]} ${leader.userId === userId ? 'TU' : name(leader.userId)}: ${leader.signal.toUpperCase()}!`, 'signal']);
  }
  if (mine && !completedTrick && game.status === 'choosing_briscola' && round.callerUserId === userId) {
    list.push([`choose:${round.number}`, 'SCEGLI LA BRISCOLA', 'hot']);
  }
  if (mine && !completedTrick && game.status === 'playing' && game.turn?.userId === userId) {
    list.push([`turn:${round.number}:${trick?.number}:${trick?.cards.length}`, 'TOCCA A TE!', 'hot']);
  }
  return list;
}

// Turns authoritative state changes into short centre-screen announcements, each shown once.
export default function useGameAnnouncements(game: GameState | null, completedTrick: Trick | null, userId: number) {
  const [state, setState] = useState({
    game: null as GameState | null, trick: null as Trick | null, seen: null as Set<string> | null,
    queue: [] as Announcement[], nextId: 0,
  });
  if (game && (game !== state.game || completedTrick !== state.trick)) {
    const seen = new Set(state.seen);
    const fresh: Announcement[] = [];
    let nextId = state.nextId;
    for (const [key, text, tone] of events(game, completedTrick, userId)) {
      if (seen.has(key)) continue;
      seen.add(key);
      // On (re)entry only the actionable prompts are worth interrupting for.
      if (state.seen || key.startsWith('turn:') || key.startsWith('choose:')) fresh.push({ id: nextId++, text, tone });
    }
    setState({ game, trick: completedTrick, seen, queue: [...state.queue, ...fresh], nextId });
  }
  const done = useCallback(() => setState((current) => ({ ...current, queue: current.queue.slice(1) })), []);
  return { announcement: state.queue[0] ?? null, done };
}
