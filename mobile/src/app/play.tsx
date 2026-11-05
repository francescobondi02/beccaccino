import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/ActionButton';
import FitScreen from '@/components/FitScreen';
import Offset from '@/components/Offset';
import Panel from '@/components/Panel';
import ScreenHeader from '@/components/ScreenHeader';
import { colors, fonts } from '@/constants/theme';
import { useSession } from '@/context/SessionContext';
import useSocketRefresh from '@/hooks/useSocketRefresh';
import { readLobby, readRoomCode, readWaitingRoom, type Lobby, type WaitingRoom } from '@/lib/game';
import { touchFeedback } from '@/lib/haptics';
import { sessionRequest } from '@/lib/session';

const lobbyEvents = ['room_created', 'room_updated', 'room_full', 'room_deleted'] as const;
const roomColors = [colors.primary, colors.pink, colors.purple];
const visibleRooms = 4;

function Seats({ room }: { room: WaitingRoom }) {
  return (
    <View style={styles.seats}>{[0, 1, 2, 3].map((index) =>
      <View key={index} style={[styles.seat, index < room.players.length && styles.seatTaken]} />)}</View>
  );
}

function RoomCard({ room, index, label, me, disabled, onPress }: {
  room: WaitingRoom; index: number; label: string; me: number; disabled: boolean; onPress: () => void;
}) {
  const names = room.players.map((p) => p.userId === me ? 'Tu' : p.username)
    .sort((a, b) => Number(b === 'Tu') - Number(a === 'Tu')).join(', ');
  return (
    <Pressable accessibilityRole="button" disabled={disabled}
      accessibilityLabel={`${label} ${room.code}, ${room.players.length} su 4: ${names}`}
      onPress={() => { touchFeedback(); onPress(); }}>
      {({ pressed }) => (
        <Offset color={colors.purpleDeep} depth={4} radius={10}>
          <View style={[styles.room, { backgroundColor: roomColors[index % roomColors.length] },
            pressed && styles.roomPressed, disabled && styles.roomDisabled]}>
            <View style={styles.roomText}>
              <Text style={styles.roomCode}>{room.code}</Text>
              <Text numberOfLines={1} style={styles.roomNames}>{names}</Text>
            </View>
            <Seats room={room} />
            <Text style={styles.roomAction}>{label.toUpperCase()} ›</Text>
          </View>
        </Offset>
      )}
    </Pressable>
  );
}

export default function PlayScreen() {
  const router = useRouter();
  const { state: session } = useSession();
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const request = useRef<AbortController | null>(null);
  const signedIn = session.status === 'signedIn';

  const load = useCallback(async () => {
    const signal = request.current?.signal;
    if (!signal) return;
    try {
      const next = readLobby(await sessionRequest('/api/rooms/available', signal));
      if (!signal.aborted) { setLobby(next); setError(null); }
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'Non riesco a caricare le stanze.');
    }
  }, []);
  useFocusEffect(useCallback(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(null);
    void load();
    return () => { controller.abort(); request.current = null; };
  }, [load, signedIn]));
  const { online } = useSocketRefresh((socket) => socket.emit('join_lobby'), lobbyEvents, () => void load());

  // Every action that creates or joins a room goes through here: one at a time, errors shown inline.
  const act = async (key: string, action: (signal: AbortSignal) => Promise<string>) => {
    const signal = request.current?.signal;
    if (!signal || pending) return;
    setPending(key);
    setError(null);
    try {
      const path = await action(signal);
      if (!signal.aborted) router.push(path as never);
    } catch (cause) {
      if (signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Operazione non riuscita.');
      await load();
    } finally {
      if (!signal.aborted) setPending(null);
    }
  };
  const startPractice = () => act('practice', async (signal) =>
    `/game/${readRoomCode(await sessionRequest('/api/rooms/practice', signal, { tier: 'forte' }, 90_000))}`);
  const create = () => act('create', async (signal) =>
    `/room/${readWaitingRoom(await sessionRequest('/api/rooms', signal, {})).code}`);
  const join = (roomCode: string) => act(`join:${roomCode}`, async (signal) =>
    `/room/${readWaitingRoom(await sessionRequest('/api/rooms/join', signal, { roomCode })).code}`);
  const validCode = /^[A-Z0-9]{6}$/.test(code);

  if (!signedIn) return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title="Gioca" />
      <FitScreen>
        <Panel style={styles.signedOut}>
          <Text style={styles.eyebrow}>✳︎  SERVE UN ACCOUNT</Text>
          <Text accessibilityRole="header" style={styles.title}>Siediti al tavolo.</Text>
          <Text style={styles.body}>Accedi con il tuo account BECCA per allenarti con i bot o giocare con gli amici.</Text>
          <ActionButton bolt label="Accedi per giocare" onPress={() => router.navigate('/account')} />
        </Panel>
      </FitScreen>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title="Gioca" />
      <FitScreen>
        <View style={styles.layout}>
          <View style={styles.side}>
            <Panel>
              <Text style={styles.eyebrow}>✳︎  ALLENAMENTO</Text>
              <Text style={styles.cardTitle}>Tu, il socio e due rivali: tutti bot allenati.</Text>
              {lobby?.practice
                ? <ActionButton bolt label="Riprendi" disabled={pending !== null}
                  onPress={() => router.push(`/game/${lobby.practice!.code}`)} />
                : <ActionButton bolt label={pending === 'practice' ? 'Preparo il tavolo…' : 'Gioca contro i bot'}
                  disabled={!lobby || pending !== null} onPress={() => void startPractice()} />}
              {pending === 'practice' && <Text style={styles.note}>Il primo avvio dei bot può richiedere fino a un minuto e mezzo.</Text>}
            </Panel>
            <View style={styles.friends}>
              <Text style={styles.eyebrow}>✳︎  CON GLI AMICI</Text>
              <ActionButton secondary label={pending === 'create' ? 'Creo la stanza…' : 'Crea una stanza'}
                disabled={!lobby || pending !== null} onPress={() => void create()} />
              <View style={styles.codeRow}>
                <TextInput accessibilityLabel="Codice stanza" placeholder="CODICE" placeholderTextColor="#6f6a7d"
                  value={code} onChangeText={(value) => setCode(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  autoCapitalize="characters" autoCorrect={false} maxLength={6} returnKeyType="go"
                  onSubmitEditing={() => { if (validCode) void join(code); }}
                  selectionColor={colors.primary} style={styles.codeInput} />
                <ActionButton compact label="Entra" disabled={!validCode || pending !== null} onPress={() => void join(code)} />
              </View>
            </View>
          </View>
          <View style={styles.main}>
            <View style={styles.listHeader}>
              <Text accessibilityRole="header" style={styles.listTitle}>{lobby?.games.length ? 'LE TUE PARTITE' : 'STANZE APERTE'}</Text>
              <View accessible accessibilityLabel={online ? 'Aggiornamento dal vivo attivo' : 'Aggiornamento dal vivo non disponibile'}
                style={styles.live}>
                <View style={[styles.liveDot, online && styles.liveDotOn]} />
                <Text style={styles.liveText}>{online ? 'DAL VIVO' : 'OFFLINE'}</Text>
              </View>
            </View>
            {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            {!lobby && !error && <ActivityIndicator accessibilityLabel="Carico le stanze" color={colors.primary} />}
            {lobby?.games.slice(0, 2).map((room, index) => <RoomCard key={room.code} room={room} index={index} label="Rientra"
              me={session.user.id} disabled={pending !== null} onPress={() => router.push(`/game/${room.code}`)} />)}
            {!!lobby?.games.length && <Text accessibilityRole="header" style={[styles.listTitle, styles.subTitle]}>STANZE APERTE</Text>}
            {lobby && lobby.open.length === 0 && (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Nessuna stanza aperta.</Text>
                <Text style={styles.body}>Creane una e condividi il codice: i posti vuoti li possono coprire i bot.</Text>
              </View>
            )}
            {lobby?.open.slice(0, visibleRooms - Math.min(2, lobby.games.length)).map((room, index) =>
              <RoomCard key={room.code} room={room} index={index + 1} label="Entra" me={session.user.id}
                disabled={pending !== null} onPress={() => void join(room.code)} />)}
            {lobby && lobby.open.length > visibleRooms - Math.min(2, lobby.games.length) &&
              <Text style={styles.note}>Altre stanze disponibili: entra con il codice.</Text>}
          </View>
        </View>
      </FitScreen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  layout: { flexDirection: 'row', gap: 24, paddingHorizontal: 24, paddingVertical: 14, maxWidth: 960, width: '100%', alignSelf: 'center' },
  side: { width: 300, gap: 18 },
  main: { flex: 1, gap: 10 },
  signedOut: { maxWidth: 520, alignSelf: 'center', margin: 20 },
  eyebrow: { color: colors.pink, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { ...fonts.display, color: colors.text, fontSize: 28 },
  cardTitle: { ...fonts.body, color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  body: { ...fonts.body, color: colors.muted, fontSize: 14, lineHeight: 20 },
  note: { ...fonts.body, color: colors.muted, fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  friends: { gap: 10 },
  codeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  codeInput: { flex: 1, minHeight: 44, borderRadius: 7, borderWidth: 2, borderColor: colors.line, paddingHorizontal: 12,
    color: colors.text, backgroundColor: colors.surface, fontSize: 18, fontWeight: '800', letterSpacing: 4 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listTitle: { ...fonts.display, color: colors.text, fontSize: 22 },
  subTitle: { fontSize: 16, marginTop: 6 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  liveDotOn: { backgroundColor: colors.primary },
  liveText: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  empty: { gap: 6, padding: 18, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line },
  emptyTitle: { ...fonts.display, color: colors.text, fontSize: 20 },
  room: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 10, borderWidth: 2, borderColor: colors.ink },
  roomPressed: { transform: [{ translateX: 3 }, { translateY: 3 }] },
  roomDisabled: { opacity: 0.6 },
  roomText: { flex: 1 },
  roomCode: { ...fonts.display, color: colors.ink, fontSize: 20, letterSpacing: 1 },
  roomNames: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  seats: { flexDirection: 'row', gap: 4 },
  seat: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.ink },
  seatTaken: { backgroundColor: colors.ink },
  roomAction: { color: colors.ink, fontSize: 13, fontWeight: '900', fontStyle: 'italic' },
});
