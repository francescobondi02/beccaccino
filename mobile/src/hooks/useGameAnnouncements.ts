import { useCallback, useState } from 'react';
import { signalIcons, type GameState, type Room, type Trick } from '@/lib/game';

export type Tone = 'hot' | 'info' | 'signal';
export type Announcement = { id: number; text: string; tone: Tone };
type Snapshot = { game: GameState; room: Room };

function events({ game, room }: Snapshot, completedTrick: Trick | null, userId: number): [string, string, Tone][] {
  const name = (id: number | undefined) => room.players.find((p) => p.userId === id)?.username.toUpperCase() ?? '';
  const myTeam = room.players.find((p) => p.userId === userId)?.team;
  const mine = !game.playerControls.some((p) => p.userId === userId && p.botModel !== null);
  const leader = game.playedCards[0];
  const list: [string, string, Tone][] = [[`round:${game.round.number}`, `MANO ${game.round.number}`, 'info']];
  if (game.round.briscola) list.push([`trump:${game.round.id}`, `BRISCOLA: ${game.round.briscola.toUpperCase()}`, 'hot']);
  if (completedTrick) {
    const winner = room.players.find((p) => p.userId === completedTrick.winnerUserId);
    list.push([`trick:${completedTrick.roundId}:${completedTrick.handNumber}`,
      winner?.userId === userId ? 'PRESA TUA!' : winner?.team === myTeam ? 'PRESA DEL SOCIO!' : `PRESA A ${name(winner?.userId)}`,
      winner?.team === myTeam ? 'hot' : 'info']);
  }
  if (leader?.signal) {
    list.push([`signal:${game.round.id}:${game.currentHandNumber}`,
      `${signalIcons[leader.signal]} ${leader.userId === userId ? 'TU' : name(leader.userId)}: ${leader.signal.toUpperCase()}!`, 'signal']);
  }
  if (mine && !completedTrick && game.status === 'choosing_briscola' && game.callerUserId === userId) {
    list.push([`choose:${game.round.id}`, 'SCEGLI LA BRISCOLA', 'hot']);
  }
  if (mine && !completedTrick && game.status === 'playing' && game.currentTurnUserId === userId) {
    list.push([`turn:${game.round.id}:${game.currentHandNumber}:${game.playedCards.length}`, 'TOCCA A TE!', 'hot']);
  }
  return list;
}

// Turns authoritative snapshot changes into short centre-screen announcements, each shown once.
export default function useGameAnnouncements(snapshot: Snapshot | null, completedTrick: Trick | null, userId: number) {
  const [state, setState] = useState({
    snapshot: null as Snapshot | null, trick: null as Trick | null, seen: null as Set<string> | null,
    queue: [] as Announcement[], nextId: 0,
  });
  if (snapshot && (snapshot !== state.snapshot || completedTrick !== state.trick)) {
    const seen = new Set(state.seen);
    const fresh: Announcement[] = [];
    let nextId = state.nextId;
    for (const [key, text, tone] of events(snapshot, completedTrick, userId)) {
      if (seen.has(key)) continue;
      seen.add(key);
      // On (re)entry only the actionable prompts are worth interrupting for.
      if (state.seen || key.startsWith('turn:') || key.startsWith('choose:')) fresh.push({ id: nextId++, text, tone });
    }
    setState({ snapshot, trick: completedTrick, seen, queue: [...state.queue, ...fresh], nextId });
  }
  const done = useCallback(() => setState((current) => ({ ...current, queue: current.queue.slice(1) })), []);
  return { announcement: state.queue[0] ?? null, done };
}
