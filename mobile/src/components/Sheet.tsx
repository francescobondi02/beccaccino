import { useEffect, useState, type PropsWithChildren } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FitScreen from './FitScreen';
import Panel from './Panel';
import { colors, fonts } from '@/constants/theme';
import useReducedMotion from '@/hooks/useReducedMotion';
import { touchFeedback } from '@/lib/haptics';
import { playSound } from '@/lib/sound';

type Props = PropsWithChildren<{ title: string; onClose?: () => void; width?: number }>;

// Pops in with a spring; the corner X closes it.
export function SheetPanel({ title, onClose, width = 560, children }: Props) {
  const reduced = useReducedMotion() !== false;
  const [pop] = useState(() => new Animated.Value(0.85));
  useEffect(() => {
    if (reduced) { pop.setValue(1); return; }
    const animation = Animated.spring(pop, { toValue: 1, damping: 11, stiffness: 220, mass: 0.7, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [pop, reduced]);
  return (
    <Animated.View accessibilityViewIsModal style={[styles.wrap, { maxWidth: width, transform: [{ scale: pop }] }]}>
      <Panel>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          {onClose && <Pressable accessibilityRole="button" accessibilityLabel="Chiudi" hitSlop={10}
            onPress={() => { touchFeedback(); playSound('tap'); onClose(); }}
            style={({ pressed }) => [styles.close, pressed && styles.closePressed]}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>}
        </View>
        {children}
      </Panel>
    </Animated.View>
  );
}

// Full-screen dimmed layer; tapping outside the panel closes it.
export default function Sheet({ onClose, ...panel }: Props) {
  return (
    <SafeAreaView style={styles.backdrop}>
      {onClose && <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />}
      <FitScreen>
        <View pointerEvents="box-none" style={styles.content}><SheetPanel onClose={onClose} {...panel} /></View>
      </FitScreen>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#08060dd9' },
  content: { padding: 20 },
  wrap: { width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { ...fonts.display, flex: 1, fontSize: 26, color: colors.primary },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.purple, backgroundColor: colors.background },
  closePressed: { transform: [{ scale: 0.9 }] },
  closeText: { color: colors.text, fontSize: 16, fontWeight: '900' },
});
