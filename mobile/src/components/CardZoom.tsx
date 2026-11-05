import { useEffect, useState } from 'react';
import { Animated, Image, StyleSheet, Text } from 'react-native';
import { colors } from '@/constants/theme';
import { cardImage } from '@/lib/cardImages';
import { cardLabel, type Card } from '@/lib/game';

// Large preview shown while a hand card is long-pressed.
export default function CardZoom({ card, note, reduced }: { card: Card | null; note?: string; reduced: boolean }) {
  const [pop] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!card) return;
    pop.setValue(reduced ? 1 : 0.6);
    const animation = Animated.spring(pop, { toValue: 1, damping: 12, stiffness: 260, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [card, pop, reduced]);
  if (!card) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.layer, { opacity: pop, transform: [{ scale: pop }] }]}>
      <Image source={cardImage(card)} accessible={false} style={styles.card} />
      <Text style={styles.label}>{cardLabel(card).toUpperCase()}</Text>
      {note && <Text style={styles.note}>{note}</Text>}
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 8, zIndex: 60 },
  card: { height: '62%', aspectRatio: 0.63, borderRadius: 12, borderWidth: 3, borderColor: '#fff', backgroundColor: '#fff' },
  label: { color: colors.text, fontSize: 18, fontWeight: '900', fontStyle: 'italic',
    textShadowColor: colors.ink, textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0 },
  note: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
});
