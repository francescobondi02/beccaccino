import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';

import ActionButton from '@/components/ActionButton';
import Sheet from '@/components/Sheet';
import { colors, fonts } from '@/constants/theme';
import useCloseOrHome from '@/hooks/useCloseOrHome';

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
  const [page, setPage] = useState(0);
  const rule = rules[page];
  const [slide] = useState(() => new Animated.Value(0));
  const go = (next: number) => {
    if (next < 0 || next >= rules.length) return;
    slide.setValue(next > page ? 40 : -40);
    setPage(next);
  };
  useEffect(() => {
    const animation = Animated.spring(slide, { toValue: 0, damping: 16, stiffness: 200, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [page, slide]);
  // Horizontal swipe flips rules like cards; the arrow buttons remain for accessibility.
  const swipe = PanResponder.create({
    onMoveShouldSetPanResponder: (_, { dx, dy }) => Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy),
    onPanResponderRelease: (_, { dx }) => { if (Math.abs(dx) > 40) go(dx < 0 ? page + 1 : page - 1); },
  });

  const close = useCloseOrHome();
  return (
    <Sheet title="Come si gioca" onClose={close} width={640}>
      <Animated.View {...swipe.panHandlers} style={[styles.copyCard, { transform: [{ translateX: slide }],
        opacity: slide.interpolate({ inputRange: [-40, 0, 40], outputRange: [0, 1, 0] }) }]}>
        <Text accessible={false} importantForAccessibility="no" style={styles.number}>{String(page + 1).padStart(2, '0')}</Text>
        <Text accessibilityRole="header" style={styles.heading}>{rule.title}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.description}>{rule.body}</Text>
      </Animated.View>
      <View style={styles.pager}>
        <ActionButton compact secondary label="Regola precedente" glyph="‹" disabled={page === 0} onPress={() => go(page - 1)} />
        <View accessible accessibilityLabel={`Regola ${page + 1} di ${rules.length}`} style={styles.dots}>
          {rules.map((item, index) => <View key={item.title} style={[styles.dot, index === page && styles.dotActive]} />)}
        </View>
        {page === rules.length - 1
          ? <ActionButton compact bolt label="Prova una presa"
            accessibilityHint="Metti in pratica le regole in una breve prova guidata offline"
            onPress={() => router.replace('/tutorial')} />
          : <ActionButton compact secondary label="Regola successiva" glyph="›" onPress={() => go(page + 1)} />}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  number: { color: colors.pink, fontSize: 28, fontWeight: '900', fontStyle: 'italic' },
  heading: { color: colors.text, fontSize: 20, fontWeight: '900' },
  description: { ...fonts.body, color: colors.muted, fontSize: 16, lineHeight: 24, minHeight: 100 },
  copyCard: { gap: 8 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  dotActive: { width: 22, backgroundColor: colors.primary },
});
