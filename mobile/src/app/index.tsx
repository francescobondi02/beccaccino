import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/ActionButton';
import HomeCardFan from '@/components/HomeCardFan';
import { colors } from '@/constants/theme';
import { useSession } from '@/context/SessionContext';

export default function HomeScreen() {
  const router = useRouter();
  const { state: session } = useSession();
  const { width, height, fontScale } = useWindowDimensions();
  const stacked = width < height || width < 560 || fontScale >= 1.4;
  const compact = height < 400 && !stacked;

  return (
    <SafeAreaView style={styles.screen}>
      <View pointerEvents="none" style={styles.orbit} />
      <ScrollView contentContainerStyle={[styles.content, compact && styles.compactContent]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.brand}>BECCA<Text style={styles.brandDot}>.</Text></Text>
          <View style={styles.headerActions}>
            <ActionButton secondary label={session.status === 'signedIn' ? 'Account' : 'Accedi'}
              disabled={session.status === 'loading'} onPress={() => router.navigate('/account')} />
            <ActionButton
              secondary label="Connessione"
              accessibilityHint="Controlla il collegamento al server, senza accedere al tuo account"
              onPress={() => router.navigate('/connection')}
            />
          </View>
        </View>
        <View style={[styles.body, stacked && styles.stacked]}>
          <View style={[styles.hero, stacked && styles.stackedPanel]}>
            {!compact && <Text style={styles.eyebrow}>IL BELLO È GIOCARSELA INSIEME.</Text>}
            <Text accessibilityRole="header" style={[styles.title, compact && styles.compactTitle]}>
              LA PRESA{'\n'}<Text style={styles.accent}>È TUA.</Text>
            </Text>
            <Text style={styles.subtitle}>Il tuo socio ti aspetta.</Text>
            <View style={styles.actions}>
              <ActionButton
                label="Prova una presa"
                accessibilityHint="Allenati con le carte in una breve prova guidata offline"
                onPress={() => router.navigate('/tutorial')}
              />
              <ActionButton
                secondary label="Come si gioca"
                accessibilityHint="Scopri squadre, briscola e regole del Beccaccino"
                onPress={() => router.navigate('/rules')}
              />
            </View>
            <Text style={styles.availability}>{session.status === 'signedIn'
              ? `Accesso effettuato come ${session.user.username}. Partite online non ancora collegate.`
              : 'Accedi al tuo account. Partite online non ancora collegate.'}</Text>
          </View>
          <View style={[styles.art, stacked && styles.stackedPanel]}>
            <HomeCardFan height={Math.min(240, height * 0.45)} />
            <View style={styles.facts}>
              <View accessible style={styles.fact}>
                <Text style={styles.factNumber}>4</Text>
                <Text style={styles.factLabel}>giocatori</Text>
              </View>
              <View style={styles.divider} />
              <View accessible style={styles.fact}>
                <Text style={styles.factNumber}>2</Text>
                <Text style={styles.factLabel}>squadre</Text>
              </View>
              <View style={styles.divider} />
              <View accessible style={styles.fact}>
                <Text style={styles.factNumber}>40</Text>
                <Text style={styles.factLabel}>carte</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  orbit: {
    position: 'absolute', width: 520, height: 520, right: -120, top: -80,
    borderRadius: 260, borderWidth: 64, borderColor: colors.surface, opacity: 0.6,
  },
  content: { flexGrow: 1, padding: 24, gap: 16 },
  compactContent: { paddingVertical: 12, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  brand: { color: colors.text, fontSize: 28, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1 },
  brandDot: { color: colors.primary },
  body: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 24 },
  stacked: { flexDirection: 'column', alignItems: 'stretch', gap: 24 },
  hero: { flex: 1, justifyContent: 'center', gap: 10 },
  stackedPanel: { flex: 0, width: '100%' },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 56, fontWeight: '900', fontStyle: 'italic', lineHeight: 58, letterSpacing: -2 },
  compactTitle: { fontSize: 42, lineHeight: 44 },
  accent: { color: colors.primary },
  subtitle: { color: colors.text, fontSize: 17, lineHeight: 24 },
  actions: { maxWidth: 340, width: '100%', gap: 10 },
  availability: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  art: { flex: 1, alignItems: 'center' },
  facts: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 14 },
  fact: { alignItems: 'center' },
  factNumber: { color: colors.text, fontSize: 22, fontWeight: '800' },
  factLabel: { color: colors.muted, fontSize: 12 },
  divider: { width: 1, height: 24, backgroundColor: colors.border },
});
