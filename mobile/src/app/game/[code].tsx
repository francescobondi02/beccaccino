import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import ActionButton from '@/components/ActionButton';
import GameDialog from '@/components/GameDialog';
import SoundToggle from '@/components/SoundToggle';
import { CenterToast, ScoreBoard, TimerBadge, TrickReview } from '@/components/Hud';
import useGameAnnouncements from '@/hooks/useGameAnnouncements';
import useReducedMotion from '@/hooks/useReducedMotion';
import LiveTable from '@/components/LiveTable';
import { colors } from '@/constants/theme';
import { useSession } from '@/context/SessionContext';
import useLiveGame from '@/hooks/useLiveGame';
import { cardImage } from '@/lib/cardImages';
import { cardKey, cardLabel, ourSide, signalIcons, signals, suits, teamOf, type Card, type Signal } from '@/lib/game';
import { touchFeedback } from '@/lib/haptics';
import { playSound } from '@/lib/sound';
import type { SessionUser } from '@/lib/session';

function PracticeTable({ code, user }: { code: string; user: SessionUser }) {
  const router = useRouter();
  const { retry: retrySession } = useSession();
  const { snapshot, connection, error, needsLogin, busy, syncing, completedTrick, finishCollection, mutate, refresh } = useLiveGame(code, user);
  const [selection, setSelection] = useState<{ key: string; card: Card } | null>(null);
  const [signalChoice, setSignalChoice] = useState<{ key: string; signal: Signal } | null>(null);
  const [dialog, setDialog] = useState<'menu' | 'trump' | 'history' | 'abandon' | null>(null);
  const [now, setNow] = useState(Date.now);
  const reduced = useReducedMotion();
  const { announcement, done } = useGameAnnouncements(snapshot, completedTrick, user.id);
  const won = !!snapshot && snapshot.game.finishedGame?.winnerTeam === teamOf(snapshot.room, user.id);
  useEffect(() => { if (won) { touchFeedback('success'); playSound('win'); } }, [won]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { setDialog('menu'); return true; });
    return () => listener.remove();
  }, []);

  if (needsLogin) return (
    <View style={styles.loading}>
      <Text accessibilityRole="alert" style={styles.body}>Sessione scaduta. Accedi di nuovo per ritrovare il tavolo.</Text>
      <ActionButton label="Accedi di nuovo" onPress={() => { retrySession(); router.replace('/account'); }} />
    </View>
  );
  if (!snapshot) return (
    <View style={styles.loading}>
      <ActivityIndicator accessibilityLabel="Collegamento al tavolo" color={colors.primary} />
      <Text style={styles.body}>{error ?? 'Collego il tuo tavolo…'}</Text>
      <ActionButton label="Riprova" onPress={() => void refresh()} />
      <ActionButton secondary label="Torna a Gioca" onPress={() => router.replace('/play')} />
    </View>
  );
  const { game, room, playable, receivedAt } = snapshot;
  const dealReadyAt = receivedAt + (game.round.deal?.remainingMs ?? 0);
  const presentingRound = now < dealReadyAt && game.status === 'choosing_briscola';
  const showSummary = game.roundSummary !== null && presentingRound &&
    now < dealReadyAt - (game.round.deal!.animationMs + game.round.deal!.reviewMs) && !completedTrick;
  const controlledByBot = game.playerControls.some((p) => p.userId === user.id && p.botModel !== null);
  const enabled = connection === 'ready' && !busy && !syncing && !error && !completedTrick && !presentingRound;
  const turnKey = `${game.round.id}:${game.currentHandNumber}:${game.currentTurnUserId}:${game.playedCards.length}`;
  const selected = selection?.key === turnKey && playable.some((card) => cardKey(card) === cardKey(selection.card))
    ? selection : null;
  const myTurn = game.currentTurnUserId === user.id && !controlledByBot;
  const canChoose = enabled && game.status === 'choosing_briscola' && game.callerUserId === user.id && !controlledByBot;
  const canPlay = enabled && game.status === 'playing' && myTurn;
  const remaining = game.turnTimer?.totalMs === null || !game.turnTimer ? null
    : Math.max(0, Math.ceil((receivedAt + game.turnTimer.remainingMs - now) / 1000));
  const paused = game.status === 'paused';
  const finished = game.finishedGame !== null && !completedTrick;
  const overlay = dialog !== null || paused || finished || showSummary;
  const closeDialog = () => setDialog(null);
  const practice = room.isPractice;
  const summary = game.roundSummary && ourSide(room, user.id, game.roundSummary.team0Points, game.roundSummary.team1Points);
  const final = game.finishedGame && ourSide(room, user.id, game.finishedGame.finalScores.team0, game.finishedGame.finalScores.team1);
  const goHome = () => router.replace('/play');
  const pause = async () => {
    setDialog('menu');
    if (practice && !paused && game.status !== 'finished') await mutate(`/api/rooms/${code}/pause`, {});
  };
  const leave = async () => {
    if (await mutate(`/api/rooms/${code}/leave`, {})) goHome();
  };
  const signal = signalChoice?.key === turnKey ? signalChoice.signal : null;
  const signalPicker = canPlay && game.playedCards.length === 0 && <View style={styles.signalChoices}>
    <Text style={styles.signalTitle}>SEGNO?</Text>
    {signals.map((option) => <ActionButton key={option} compact secondary={signal !== option} selected={signal === option}
      label={option} glyph={`${signalIcons[option]} ${option.toUpperCase()}`}
      onPress={() => setSignalChoice(signal === option ? null : { key: turnKey, signal: option })} />)}
  </View>;
  // Tap-tap, the Gioca button and drag-to-table all end here; only cards the server marked legal are sent.
  const play = async (card = selected?.card) => {
    if (!canPlay || !card || !playable.some((legal) => cardKey(legal) === cardKey(card))) return false;
    const ok = await mutate('/api/games/play-card', { roomCode: code, ...card,
      signal: game.playedCards.length === 0 ? signal : null });
    if (ok) touchFeedback('play');
    return ok;
  };
  const controls = <>
    {remaining !== null && connection === 'ready' && !paused && <View style={styles.statusRow}><TimerBadge seconds={remaining} /></View>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {error ? <ActionButton secondary label="Riprova" onPress={() => void refresh()} />
      : controlledByBot ? <ActionButton label="Riprendi controllo" disabled={!enabled}
        onPress={() => void mutate(`/api/rooms/${code}/resume-control`, {})} />
        : game.status === 'choosing_briscola' ? <ActionButton label="Scegli briscola" disabled={!canChoose} onPress={() => setDialog('trump')} />
          : <ActionButton label={busy ? 'Invio…' : 'Gioca'} disabled={!canPlay || !selected} onPress={() => void play()} />}
  </>;
  return <View style={styles.screen}>
    <LiveTable room={room} game={game} userId={user.id} playable={playable} selected={selected?.card ?? null}
      disabled={!canPlay} onSelect={(card) => setSelection({ key: turnKey, card })} onPlay={play}
      onMenu={() => void pause()} onHistory={() => setDialog('history')} controls={controls} prompt={signalPicker || null} completedTrick={completedTrick} onCollected={finishCollection} hidden={overlay} />
    <CenterToast message={announcement} onDone={done} reduced={reduced !== false}
      sticky={connection !== 'ready' ? 'RICONNESSIONE…' : null} />
    <GameDialog title="Scegli la briscola" visible={dialog === 'trump' && !paused && !finished} onClose={closeDialog}>
      <Text style={styles.body}>Guarda la tua mano, poi scegli il seme.</Text>
      <View style={styles.cardRow}>{game.myCards.map((card, index) =>
        <Image key={cardKey(card)} source={cardImage(card)} accessible accessibilityLabel={cardLabel(card)}
          style={[styles.historyCard, index > 0 && styles.overlap]} />)}</View>
      <View style={styles.suitChoices}>{suits.map((suit) => <Pressable key={suit} accessibilityRole="button" accessibilityLabel={suit}
        accessibilityState={{ disabled: !canChoose }} disabled={!canChoose}
        onPress={() => { touchFeedback(); void mutate('/api/games/choose-briscola', { gameRoomId: room.id, suit }).then((ok) => { if (ok) closeDialog(); }); }}
        style={({ pressed }) => [styles.suit, pressed && styles.suitPressed, !canChoose && styles.suitDisabled]}>
        <Image source={cardImage({ suit, value: 'asso' })} accessible={false} style={styles.suitCard} />
        <Text style={styles.suitLabel}>{suit.toUpperCase()}</Text>
      </Pressable>)}</View>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </GameDialog>
    <GameDialog title={paused ? 'Allenamento in pausa' : 'Il tuo tavolo'} visible={!finished && !showSummary && dialog !== 'abandon' && dialog !== 'history' && (dialog === 'menu' || paused)}
      onClose={closeDialog} dismissable={!paused}>
      <Text style={styles.body}>{!practice ? 'La partita continua anche senza di te: allo scadere del tempo gioca il server. Puoi rientrare da Gioca.'
        : paused ? 'La partita è conservata sul server. Riparti quando vuoi.' : 'Metti in pausa prima di uscire: disconnettersi non ferma i bot.'}</Text>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {practice ? <ActionButton label={paused ? 'Riprendi partita' : 'Metti in pausa'} disabled={busy || connection !== 'ready'}
        onPress={() => { void mutate(`/api/rooms/${code}/${paused ? 'resume' : 'pause'}`, {}).then((ok) => { if (ok && paused) closeDialog(); }); }} />
        : <ActionButton label="Torna al tavolo" onPress={closeDialog} />}
      <View style={styles.soundRow}><SoundToggle /><Text style={styles.body}>Suoni ed effetti</Text></View>
      <View style={styles.grid}>
        {practice && <View style={styles.cell}><ActionButton compact secondary label="Torna a Gioca" disabled={!paused || busy} onPress={goHome} /></View>}
        <View style={styles.cell}><ActionButton compact secondary label={practice ? 'Abbandona allenamento' : 'Abbandona partita'} disabled={busy} onPress={() => setDialog('abandon')} /></View>
        {!practice && <View style={styles.cell}><ActionButton compact secondary label="Esci e torna dopo" onPress={goHome} /></View>}
      </View>
    </GameDialog>
    <GameDialog title="Ultima presa" visible={dialog === 'history' && !paused && !finished} onClose={closeDialog}>
      {game.lastCompletedTrick && <TrickReview trick={game.lastCompletedTrick} room={room} userId={user.id} />}
    </GameDialog>
    <GameDialog title="Abbandonare la partita?" visible={dialog === 'abandon'} onClose={() => setDialog('menu')}>
      <Text style={styles.body}>{practice ? 'L’allenamento verrà archiviato e non potrai riprenderlo. Nessun effetto sulla classifica.'
        : 'Un bot prenderà il tuo posto fino alla fine e non potrai rientrare. Il tuo socio continua a giocare.'}</Text>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <ActionButton label="Conferma abbandono" disabled={busy} onPress={() => void leave()} />
      <ActionButton secondary label="Continua a giocare" disabled={busy} onPress={() => setDialog('menu')} />
    </GameDialog>
    <GameDialog title={`Fine mano ${game.roundSummary?.roundNumber ?? ''}`} visible={showSummary && !finished} onClose={() => {}} dismissable={false}>
      <Text style={styles.body}>Noi {summary?.[0]} · Loro {summary?.[1]}</Text>
      <Text style={styles.caption}>Tra poco distribuisco le nuove carte.</Text>
    </GameDialog>
    <GameDialog title={won ? 'La partita è vostra!' : 'Vincono gli avversari'} visible={finished} onClose={() => {}} dismissable={false}>
      <View style={styles.finalBoard}><ScoreBoard us={[final?.[0] ?? 0, 0]} them={[final?.[1] ?? 0, 0]} /></View>
      <Text style={styles.body}>{game.finishedGame?.totalRounds} mani giocate. {practice ? 'Allenamento completato.' : 'Partita conclusa.'}</Text>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <ActionButton label="Torna a Gioca" disabled={busy} onPress={() => void (practice ? leave() : goHome())} />
    </GameDialog>
  </View>;
}

export default function GameScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { state: session } = useSession();
  const router = useRouter();
  if (!/^[A-Za-z0-9]{6,12}$/.test(code ?? '') || session.status !== 'signedIn') return (
    <View style={styles.loading}>
      <Text style={styles.body}>{session.status === 'loading' ? 'Verifico la sessione…' : 'Accedi per ritrovare il tuo tavolo.'}</Text>
      <ActionButton label="Account" onPress={() => router.replace('/account')} />
    </View>
  );
  return <PracticeTable key={`${session.user.id}:${code}`} code={code} user={session.user} />;
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: colors.background },
  body: { color: colors.text, fontSize: 16, lineHeight: 23 },
  caption: { color: colors.muted, fontSize: 12 },
  error: { color: '#ffb4b4', fontSize: 14 },
  cardRow: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 4 },
  historyCard: { width: 50, height: 79, borderRadius: 5, borderWidth: 1.5, borderColor: '#0d0816', backgroundColor: '#fffef8', resizeMode: 'contain' },
  overlap: { marginLeft: -14 },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexGrow: 1, flexBasis: '45%' },
  suitChoices: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
  suit: { alignItems: 'center', gap: 6, padding: 8, paddingBottom: 10, borderRadius: 14, borderWidth: 3, borderColor: '#0d0816',
    borderBottomWidth: 7, backgroundColor: '#7b4ddb' },
  suitPressed: { transform: [{ translateY: 3 }, { scale: 0.97 }], borderBottomWidth: 4 },
  suitDisabled: { opacity: 0.5 },
  suitCard: { width: 52, height: 82, borderRadius: 5, resizeMode: 'contain', backgroundColor: '#fffef8' },
  suitLabel: { color: colors.text, fontSize: 12, fontWeight: '900', fontStyle: 'italic' },
  finalBoard: { alignItems: 'center', transform: [{ scale: 1.5 }], marginVertical: 18 },
  signalChoices: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  signalTitle: { color: colors.text, fontSize: 13, fontWeight: '900', fontStyle: 'italic', textShadowColor: '#0d0816', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
});
