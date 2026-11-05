import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/ActionButton';
import FitScreen from '@/components/FitScreen';
import GameDialog from '@/components/GameDialog';
import Offset from '@/components/Offset';
import ScreenHeader from '@/components/ScreenHeader';
import { colors, fonts } from '@/constants/theme';
import { useSession } from '@/context/SessionContext';
import useSocketRefresh from '@/hooks/useSocketRefresh';
import { botStartTimeoutMs, botTiers, readWaitingRoom, type BotTier, type WaitingPlayer, type WaitingRoom } from '@/lib/game';
import { touchFeedback } from '@/lib/haptics';
import { latestOnly } from '@/lib/latest';
import { sessionRequest, type SessionUser } from '@/lib/session';

const roomEvents = ['player_joined', 'player_left', 'player_disconnected', 'team_chosen', 'ready_changed',
  'room_settings_changed', 'game_started'] as const;
const teamColors = [colors.primary, colors.pink];

function Slot({ player, me, bot, team, onSit }: {
  player: WaitingPlayer | undefined; me: boolean; bot: BotTier | null; team: string; onSit?: () => void;
}) {
  if (!player && onSit) return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Siediti nella squadra ${team}`} onPress={() => { touchFeedback(); onSit(); }}
      style={({ pressed }) => [styles.slot, styles.slotOpen, pressed && styles.slotPressed]}>
      <Text style={styles.slotOpenText}>＋ SIEDITI QUI</Text>
    </Pressable>
  );
  const label = player ? `${player.username}${me ? ' (tu)' : ''}, ${player.isReady ? 'pronto' : 'non ancora pronto'}`
    : bot ? `Posto per un bot ${bot}` : 'Posto libero';
  return (
    <View accessible accessibilityLabel={label} style={[styles.slot, !player && styles.slotEmpty, me && styles.slotMe]}>
      <Text numberOfLines={1} style={[styles.slotName, !player && styles.slotNameEmpty]}>
        {player ? player.username : bot ? `BOT ${bot.toUpperCase()}` : 'Posto libero'}
      </Text>
      {player && <View style={[styles.badge, player.isReady && styles.badgeReady]}>
        <Text style={[styles.badgeText, player.isReady && styles.badgeTextReady]}>{player.isReady ? '✓ PRONTO' : 'ATTESA'}</Text>
      </View>}
    </View>
  );
}

function WaitingRoomView({ code, user }: { code: string; user: SessionUser }) {
  const router = useRouter();
  const [room, setRoom] = useState<WaitingRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const navigate = useRef(router.replace);
  useEffect(() => { navigate.current = router.replace; });
  const toGame = useCallback(() => navigate.current(`/game/${code}`), [code]);
  const [begin] = useState(latestOnly);
  const load = useCallback(async () => {
    const signal = lifetime.current.signal;
    const latest = begin();
    try {
      const next = readWaitingRoom(await sessionRequest(`/api/rooms/${code}`, signal));
      if (signal.aborted || !latest()) return;
      if (next.started) { toGame(); return; }
      setRoom(next);
      setError(null);
    } catch (cause) {
      if (!signal.aborted && latest()) setError(cause instanceof Error ? cause.message : 'Non riesco a leggere la stanza.');
    }
  }, [begin, code, toGame]);
  useEffect(() => { void load(); }, [load]);
  const { online } = useSocketRefresh(
    (socket) => socket.emit('join_room', { roomCode: code, userId: user.id, username: user.username }),
    roomEvents, () => void load(), (event) => { if (event === 'game_started') { touchFeedback('success'); toGame(); } });

  const act = async (path: string, body: unknown, timeoutMs?: number) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await sessionRequest(path, lifetime.current.signal, body, timeoutMs);
      await load();
      return true;
    } catch (cause) {
      if (!lifetime.current.signal.aborted) setError(cause instanceof Error ? cause.message : 'Operazione non riuscita.');
      await load();
      return false;
    } finally {
      if (!lifetime.current.signal.aborted) setBusy(false);
    }
  };
  const leave = async () => { if (await act(`/api/rooms/${code}/leave`, {})) router.replace('/play'); };

  if (!room) return (
    <View style={styles.center}>
      {error ? <>
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        <ActionButton label="Riprova" onPress={() => void load()} />
        <ActionButton secondary label="Torna a Gioca" onPress={() => router.replace('/play')} />
      </> : <ActivityIndicator accessibilityLabel="Entro nella stanza" color={colors.primary} />}
    </View>
  );
  const me = room.players.find((p) => p.userId === user.id);
  const teams = [0, 1].map((team) => room.players.filter((p) => p.team === team));
  const waiting = room.players.filter((p) => p.team === null);
  const emptySeats = 4 - room.players.length;
  const hint = !me || me.team === null ? 'Tocca un posto libero per sederti.'
    : !me.isReady ? 'Premi “Sono pronto” per partire.'
      : room.players.some((p) => !p.isReady) ? 'Aspettiamo che siano tutti pronti…'
        : emptySeats && !room.botTier ? 'Mancano giocatori: invita amici o aggiungi i bot.' : 'Si parte!';
  return (
    <>
      <FitScreen>
        <View style={styles.layout}>
          <View style={styles.side}>
            <Offset color={colors.purple} depth={5} radius={12}>
              <View accessible accessibilityLabel={`Codice stanza ${code.split('').join(' ')}`} style={styles.ticket}>
                <Text style={styles.ticketLabel}>CODICE STANZA</Text>
                <Text style={styles.ticketCode}>{code}</Text>
              </View>
            </Offset>
            <ActionButton secondary label="Invita amici"
              onPress={() => void Share.share({ message: `Giochiamo a Beccaccino su BECCA! Codice stanza: ${code}` })} />
            <Text style={styles.eyebrow}>✳︎  BOT NEI POSTI VUOTI</Text>
            <View style={styles.chips}>
              {[null, ...botTiers].map((tier) => <ActionButton key={tier ?? 'none'} compact secondary={room.botTier !== tier}
                selected={room.botTier === tier} label={tier ?? 'Nessuno'} disabled={busy}
                onPress={() => { if (room.botTier !== tier) void act(`/api/rooms/${code}/bots`, { tier }); }} />)}
            </View>
          </View>
          <View style={styles.main}>
            <View style={styles.teams}>
              {teams.map((members, team) => (
                <View key={team} style={styles.team}>
                  <View style={[styles.teamHeader, { backgroundColor: teamColors[team] }]}>
                    <Text style={styles.teamTitle}>SQUADRA {team ? 'B' : 'A'}</Text>
                  </View>
                  {[0, 1].map((slot) => <Slot key={slot} player={members[slot]} me={members[slot]?.userId === user.id}
                    bot={members[slot] ? null : room.botTier} team={team ? 'B' : 'A'}
                    onSit={me && me.team !== team && !me.isReady && !busy
                      ? () => void act(`/api/rooms/${code}/choose-team`, { team }) : undefined} />)}
                </View>
              ))}
            </View>
            {waiting.length > 0 && <Text style={styles.note}>In attesa di squadra: {waiting.map((p) => p.username).join(', ')}</Text>}
            {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <View style={styles.footer}>
              <View style={styles.status}>
                <Text accessibilityLiveRegion="polite" style={styles.hint}>{hint}</Text>
                <Text style={styles.note}>{online ? 'Collegato dal vivo' : 'Ricollego…'} · {room.players.length}/4 al tavolo</Text>
              </View>
              <ActionButton compact secondary label="Esci" disabled={busy} onPress={() => setConfirmLeave(true)} />
              <ActionButton bolt={!me?.isReady} label={me?.isReady ? 'Non sono pronto' : 'Sono pronto'}
                secondary={me?.isReady} disabled={busy || !me || me.team === null}
                onPress={() => void act(`/api/rooms/${code}/ready`, { isReady: !me?.isReady }, botStartTimeoutMs)} />
            </View>
          </View>
        </View>
      </FitScreen>
      <GameDialog title="Uscire dalla stanza?" visible={confirmLeave} onClose={() => setConfirmLeave(false)}>
        <Text style={styles.body}>Liberi il tuo posto. Potrai rientrare con il codice finché la partita non inizia.</Text>
        <ActionButton label="Esci dalla stanza" disabled={busy} onPress={() => void leave()} />
        <ActionButton secondary label="Resta" onPress={() => setConfirmLeave(false)} />
      </GameDialog>
    </>
  );
}

export default function RoomScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { state: session } = useSession();
  const router = useRouter();
  const valid = /^[A-Za-z0-9]{6,12}$/.test(code ?? '');
  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title={valid ? `Stanza ${code}` : 'Stanza'} />
      {valid && session.status === 'signedIn'
        ? <WaitingRoomView key={`${session.user.id}:${code}`} code={code} user={session.user} />
        : <View style={styles.center}>
          <Text style={styles.body}>{session.status === 'loading' ? 'Verifico la sessione…' : 'Accedi per entrare nella stanza.'}</Text>
          <ActionButton label={valid ? 'Accedi' : 'Torna a Gioca'} onPress={() => router.replace(valid ? '/account' : '/play')} />
        </View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 24 },
  layout: { flexDirection: 'row', gap: 24, paddingHorizontal: 24, paddingVertical: 14, maxWidth: 960, width: '100%', alignSelf: 'center' },
  side: { width: 250, gap: 12 },
  main: { flex: 1, gap: 12 },
  ticket: { alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 2, borderColor: colors.ink,
    backgroundColor: colors.primary },
  ticketLabel: { color: colors.ink, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  ticketCode: { ...fonts.display, color: colors.ink, fontSize: 34, letterSpacing: 4 },
  eyebrow: { color: colors.pink, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  teams: { flexDirection: 'row', gap: 16 },
  team: { flex: 1, gap: 8 },
  teamHeader: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 2, borderColor: colors.ink },
  teamTitle: { ...fonts.display, color: colors.ink, fontSize: 18 },
  slot: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 2, borderColor: colors.purple, backgroundColor: colors.surface },
  slotEmpty: { borderStyle: 'dashed', borderColor: colors.line, backgroundColor: 'transparent' },
  slotMe: { borderColor: colors.primary },
  slotOpen: { justifyContent: 'center', borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: '#d9ff4312' },
  slotPressed: { transform: [{ scale: 0.97 }] },
  slotOpenText: { color: colors.primary, fontSize: 14, fontWeight: '900', fontStyle: 'italic' },
  slotName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '800' },
  slotNameEmpty: { color: colors.muted, fontWeight: '600', fontStyle: 'italic' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.line },
  badgeReady: { backgroundColor: colors.primary },
  badgeText: { color: colors.muted, fontSize: 10, fontWeight: '900' },
  badgeTextReady: { color: colors.ink },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  status: { flex: 1, gap: 2 },
  hint: { ...fonts.display, color: colors.text, fontSize: 17, letterSpacing: -0.3 },
  note: { ...fonts.body, color: colors.muted, fontSize: 12, lineHeight: 17 },
  body: { ...fonts.body, color: colors.muted, fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
