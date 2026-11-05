import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Offset from './Offset';
import { colors } from '@/constants/theme';
import { touchFeedback } from '@/lib/haptics';
import { playSound } from '@/lib/sound';

// A tile-like button that sinks into its flat offset shadow while pressed, with tap feedback.
export default function OffsetPressable({ radius, style, onPress, children, ...props }: Omit<PressableProps, 'children' | 'style' | 'onPress'> & {
  radius: number; style?: StyleProp<ViewStyle>; onPress: () => void; children: ReactNode;
}) {
  return (
    <Pressable accessibilityRole="button" style={style} {...props}
      onPress={() => { touchFeedback(); playSound('tap'); onPress(); }}>
      {({ pressed }) => (
        <Offset color={colors.purpleDeep} depth={4} radius={radius}>
          <View style={pressed && styles.pressed}>{children}</View>
        </Offset>
      )}
    </Pressable>
  );
}
const styles = StyleSheet.create({ pressed: { transform: [{ translateX: 3 }, { translateY: 3 }] } });
