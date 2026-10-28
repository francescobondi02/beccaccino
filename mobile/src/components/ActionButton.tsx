import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/constants/theme';

type Props = {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
};

export default function ActionButton({
  label, onPress, secondary = false, disabled = false, accessibilityHint,
}: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: secondary ? '#ffffff20' : '#10101420' }}
      style={({ pressed }) => [
        styles.button, secondary && styles.secondary, (pressed || disabled) && styles.dimmed,
      ]}
    >
      <Text style={[styles.label, secondary && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52, minWidth: 48, paddingVertical: 12, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary, borderRadius: 16, overflow: 'hidden',
  },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  label: { flexShrink: 1, color: colors.background, fontSize: 17, fontWeight: '800', lineHeight: 24, textAlign: 'center' },
  secondaryLabel: { color: colors.text },
  dimmed: { opacity: 0.65 },
});
