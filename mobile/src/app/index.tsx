import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/ActionButton';
import FitScreen from '@/components/FitScreen';
import HomeCardFan from '@/components/HomeCardFan';
import Logo from '@/components/Logo';
import Offset from '@/components/Offset';
import OffsetPressable from '@/components/OffsetPressable';
import SoundToggle from '@/components/SoundToggle';
import { colors, fonts, shared } from '@/constants/theme';
import { useSession } from '@/context/SessionContext';
import { touchFeedback } from '@/lib/haptics';
import { playSound } from '@/lib/sound';

function Tile({ label, hint, icon, onPress }: { label: string; hint: string; icon: React.ReactNode; onPress: () => void }) {
  return (
    <OffsetPressable radius={12} accessibilityLabel={label} accessibilityHint={hint} style={styles.tileSlot} onPress={onPress}>
      <View style={styles.tile}>
        <View style={styles.tileIcon}>{icon}</View>
        <Text style={styles.tileLabel}>{label.toUpperCase()}</Text>
      </View>
    </OffsetPressable>
  );
}

// Game-style home: brand and profile on top, artwork on the left, one big thumb-reachable GIOCA bottom right.
export default function HomeScreen() {
  const router = useRouter();
  const { state: session } = useSession();
  const { height } = useWindowDimensions();
  const signedIn = session.status === 'signedIn';

  return (
    <SafeAreaView style={shared.screen}>
      <FitScreen>
        <View style={styles.content}>
          <View style={styles.header}>
            <Logo />
            <View style={styles.headerActions}>
              <SoundToggle />
              <Pressable accessibilityRole="button" disabled={session.status === 'loading'}
                accessibilityLabel={signedIn ? `Account di ${session.user.username}` : 'Accedi'}
                onPress={() => { touchFeedback(); playSound('tap'); router.navigate('/account'); }}
                style={({ pressed }) => [styles.profile, pressed && styles.tilePressed]}>
                <View style={[styles.avatar, !signedIn && styles.avatarGuest]}>
                  <Text style={styles.avatarText}>{signedIn ? session.user.username.slice(0, 1).toUpperCase() : '?'}</Text>
                </View>
                <Text numberOfLines={1} style={styles.profileName}>{signedIn ? session.user.username : 'Accedi'}</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.body}>
            <Offset color="#272032" depth={8} radius={18} style={styles.artWrap}>
              <View style={styles.art}>
                <HomeCardFan height={Math.min(220, height * 0.52)} />
                <View style={styles.sticker}><Text style={styles.stickerText}>LA PRESA{'\n'}È TUA.</Text></View>
              </View>
            </Offset>
            <View style={styles.side}>
              <Text accessibilityRole="header" style={styles.title}>NON È SOLO{'\n'}<Text style={styles.accent}>FORTUNA.</Text></Text>
              <ActionButton bolt label="Gioca" hero="BOT O AMICI" onPress={() => router.navigate('/play')} />
              <View style={styles.tiles}>
                <Tile label="Regole" hint="Squadre, briscola e segni in cinque schede" onPress={() => router.navigate('/rules')}
                  icon={<Text style={styles.tileGlyph}>?</Text>} />
                <Tile label="Prova" hint="Una presa guidata per imparare i comandi" onPress={() => router.navigate('/tutorial')}
                  icon={<Image source={require('../../assets/cards/asso_coppe.png')} style={styles.tileCard} />} />
              </View>
            </View>
          </View>
        </View>
      </FitScreen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingVertical: 10, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 190, paddingLeft: 4, paddingRight: 14, height: 44,
    borderRadius: 22, borderWidth: 2, borderColor: colors.purple, backgroundColor: colors.surface },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  avatarGuest: { backgroundColor: colors.pink },
  avatarText: { color: colors.ink, fontSize: 16, fontWeight: '900', fontStyle: 'italic' },
  profileName: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '800' },
  body: { flexDirection: 'row', alignItems: 'stretch', gap: 28 },
  artWrap: { flex: 1.15 },
  art: { flex: 1, minHeight: 250, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1,
    borderColor: '#9b6bff70', backgroundColor: '#7a3fe3' },
  sticker: { position: 'absolute', left: -14, bottom: 22, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6,
    borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.pink, transform: [{ rotate: '-12deg' }] },
  stickerText: { color: colors.ink, fontSize: 16, lineHeight: 16, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1 },
  side: { flex: 1, justifyContent: 'flex-end', gap: 14 },
  title: { ...fonts.display, color: colors.text, fontSize: 34, lineHeight: 38, letterSpacing: -1.5 },
  accent: { color: colors.primary },
  tiles: { flexDirection: 'row', gap: 12 },
  tileSlot: { flex: 1 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 56, paddingHorizontal: 12, borderRadius: 12,
    borderWidth: 2, borderColor: colors.purple, backgroundColor: colors.surface },
  tilePressed: { transform: [{ translateX: 3 }, { translateY: 3 }] },
  tileIcon: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  tileGlyph: { color: colors.primary, fontSize: 28, fontWeight: '900', fontStyle: 'italic' },
  tileCard: { width: 26, height: 40, borderRadius: 3, borderWidth: 1.5, borderColor: '#fff', transform: [{ rotate: '-8deg' }] },
  tileLabel: { color: colors.text, fontSize: 14, fontWeight: '900', fontStyle: 'italic' },
});
