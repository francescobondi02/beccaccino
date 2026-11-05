import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/constants/theme';
import { touchFeedback } from '@/lib/haptics';
import { playSound, setSoundEnabled, useSoundEnabled } from '@/lib/sound';

export default function SoundToggle() {
  const on = useSoundEnabled();
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel="Suoni" accessibilityState={{ checked: on }} hitSlop={6}
      onPress={() => { touchFeedback(); setSoundEnabled(!on); if (!on) playSound('tap'); }}
      style={({ pressed }) => [styles.button, !on && styles.off, pressed && styles.pressed]}>
      <Text style={[styles.note, !on && styles.noteOff]}>♪</Text>
      {!on && <View pointerEvents="none" style={styles.slash} />}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.purple, backgroundColor: colors.surface },
  off: { borderColor: colors.line },
  pressed: { transform: [{ scale: 0.9 }] },
  note: { color: colors.primary, fontSize: 20, fontWeight: '900' },
  noteOff: { color: colors.muted },
  slash: { position: 'absolute', width: 26, height: 2.5, borderRadius: 2, backgroundColor: colors.pink, transform: [{ rotate: '-45deg' }] },
});
