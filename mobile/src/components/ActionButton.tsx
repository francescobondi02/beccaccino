import { useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import Offset from './Offset';
import { colors, fonts } from '@/constants/theme';
import { touchFeedback } from '@/lib/haptics';
import { playSound } from '@/lib/sound';

type Props = {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  compact?: boolean;
  glyph?: string;
  bolt?: boolean;
  selected?: boolean;
  hero?: string;
  accessibilityHint?: string;
};

const tones = {
  primary: { face: colors.primary, edge: colors.ink, shadow: colors.purple, text: colors.ink },
  secondary: { face: colors.surface, edge: colors.purple, shadow: colors.purpleDeep, text: colors.text },
  selected: { face: colors.pink, edge: colors.ink, shadow: colors.purpleDeep, text: colors.ink },
  disabled: { face: '#24212b', edge: colors.line, shadow: '#1c1a22', text: '#7d7889' },
};

// Same language as the website's `.club-button`: flat face, dark edge, solid offset shadow it sinks into.
export default function ActionButton({
  label, onPress, secondary = false, disabled = false, compact = false, glyph, bolt = false, selected, hero, accessibilityHint,
}: Props) {
  const tone = tones[disabled ? 'disabled' : selected ? 'selected' : secondary ? 'secondary' : 'primary'];
  const [press] = useState(() => new Animated.Value(0));
  const spring = (toValue: number) => Animated.spring(press, {
    toValue, damping: 18, stiffness: toValue ? 600 : 360, mass: 0.4, useNativeDriver: true,
  }).start();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPressIn={() => spring(1)}
      onPressOut={() => spring(0)}
      onPress={() => { touchFeedback(); playSound('tap'); onPress(); }}
    >
      <Offset color={tone.shadow} depth={compact ? 3 : hero !== undefined ? 6 : 4} radius={7} press={press}>
        <Animated.View style={[styles.face, compact && styles.compact, hero !== undefined && styles.hero, glyph && glyph.length <= 2 && styles.square,
          { backgroundColor: tone.face, borderColor: tone.edge }]}>
          <View style={styles.copy}>
            <Text style={[styles.label, compact && styles.compactLabel, glyph && glyph.length <= 2 && styles.glyph,
              hero !== undefined && styles.heroLabel, { color: tone.text }]}>{glyph ?? label.toUpperCase()}</Text>
            {hero && <Text style={[styles.heroSub, { color: tone.text }]}>{hero}</Text>}
          </View>
          {bolt && !disabled && <Image source={require('../../assets/bolt.png')} accessible={false} style={styles.bolt} />}
        </Animated.View>
      </Offset>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  face: {
    minHeight: 50, paddingHorizontal: 20, gap: 14, borderRadius: 7, borderWidth: 2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  compact: { minHeight: 40, paddingHorizontal: 14, gap: 8 },
  square: { minWidth: 40, paddingHorizontal: 8 },
  label: { ...fonts.label, flexShrink: 1, fontSize: 15, lineHeight: 20, textAlign: 'center', letterSpacing: -0.2 },
  compactLabel: { fontSize: 12, lineHeight: 16 },
  glyph: { fontSize: 24, lineHeight: 28 },
  bolt: { width: 20, height: 20 },
  copy: { flexShrink: 1, alignItems: 'center' },
  hero: { minHeight: 78, borderRadius: 10, gap: 18 },
  heroLabel: { ...fonts.display, fontSize: 32, lineHeight: 36, letterSpacing: -1 },
  heroSub: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, opacity: 0.75 },
});
