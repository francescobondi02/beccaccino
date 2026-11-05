import type { PropsWithChildren } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

// The website's signature flat offset shadow (box-shadow: Npx Npx 0 color), drawn as a solid block so
// it looks identical on iOS and Android. `press` (0→1) pushes the face into its shadow.
export default function Offset({ children, color, depth = 4, radius = 8, press, style }: PropsWithChildren<{
  color: string; depth?: number; radius?: number; press?: Animated.Value; style?: StyleProp<ViewStyle>;
}>) {
  const shift = press?.interpolate({ inputRange: [0, 1], outputRange: [0, depth - 1] }) ?? 0;
  return (
    <View style={[{ marginRight: depth, marginBottom: depth }, style]}>
      <View>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { top: depth, left: depth, right: -depth, bottom: -depth,
          borderRadius: radius, backgroundColor: color }]} />
        <Animated.View style={{ transform: [{ translateX: shift }, { translateY: shift }] }}>{children}</Animated.View>
      </View>
    </View>
  );
}
