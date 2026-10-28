import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/ActionButton';
import { colors } from '@/constants/theme';

const rules = [
  {
    title: 'Il socio è di fronte a te.',
    body: 'Si gioca in quattro. Tu e il giocatore di fronte formate una squadra: le vostre prese si sommano. Le altre due persone sono gli avversari.',
  },
  {
    title: 'Una briscola cambia tutto.',
    body: 'Nella prima mano chi ha il quattro di denara sceglie la briscola e apre la prima presa. Nelle mani successive questo ruolo passa al giocatore seguente. La briscola è il seme che batte gli altri.',
  },
  {
    title: 'Segui il seme. Poi fai la tua mossa.',
    body: 'Se hai una carta del seme giocato per primo, devi rispondere con quel seme. Altrimenti puoi giocare qualsiasi carta. Vince la briscola più forte oppure, se non ci sono briscole, la carta più forte del seme iniziale.',
  },
  {
    title: 'La forza non è il valore.',
    body: 'Dalla più forte: tre, due, asso, re, cavallo, fante, sette, sei, cinque, quattro. L’asso vale un punto; tre, due, re, cavallo e fante valgono un terzo ciascuno. L’ultima presa vale un punto extra. L’obiettivo standard è raggiungere 41 punti di squadra.',
  },
  {
    title: 'Il tuo socio sa ascoltare.',
    body: 'Quando apri una presa puoi dichiarare un segnale: “striscio” per indicare forza, “busso” per chiedere una carta alta, “volo” per dire che è la tua unica carta di quel seme. Attenzione: il segnale lo vedono anche gli avversari.',
  },
];

export default function RulesScreen() {
  const router = useRouter();

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>QUATTRO AMICI. DUE SQUADRE.</Text>
          <Text accessibilityRole="header" style={styles.title}>Le basi. Poi ci metti del tuo.</Text>
          <Text style={styles.subtitle}>Non devi sapere tutto subito. Parti dal tuo socio.</Text>
        </View>
        {rules.map((rule, index) => (
          <View key={rule.title} style={styles.rule}>
            <Text accessible={false} importantForAccessibility="no" style={styles.number}>{String(index + 1).padStart(2, '0')}</Text>
            <View style={styles.copy}>
              <Text accessibilityRole="header" style={styles.heading}>{rule.title}</Text>
              <Text style={styles.description}>{rule.body}</Text>
            </View>
          </View>
        ))}
        <View style={styles.action}>
          <ActionButton
            label="Prova una presa"
            accessibilityHint="Metti in pratica le regole in una breve prova guidata offline"
            onPress={() => router.navigate('/tutorial')}
          />
          <ActionButton
            secondary label="Tutto chiaro"
            accessibilityHint="Torna alla home"
            onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: 24, gap: 24, maxWidth: 880, width: '100%', alignSelf: 'center' },
  intro: { gap: 10, paddingBottom: 8 },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 32, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 17, lineHeight: 26 },
  rule: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  number: { color: colors.primary, fontSize: 18, fontWeight: '900', paddingTop: 3 },
  copy: { flex: 1, gap: 8 },
  heading: { color: colors.text, fontSize: 20, fontWeight: '800' },
  description: { color: colors.muted, fontSize: 17, lineHeight: 27 },
  action: { maxWidth: 340, width: '100%', paddingTop: 8, gap: 12 },
});
