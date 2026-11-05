import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Offset from './Offset';
import { colors } from '@/constants/theme';

// The website's `.club-dialog` surface: dark card, purple edge, flat acid shadow. `style` sizes the whole panel.
export default function Panel({ children, style, shadow = colors.primary }: PropsWithChildren<{
  style?: StyleProp<ViewStyle>; shadow?: string;
}>) {
  return (
    <Offset color={shadow} depth={6} radius={15} style={style}>
      <View style={styles.panel}>{children}</View>
    </Offset>
  );
}
const styles = StyleSheet.create({
  panel: { padding: 20, gap: 12, borderRadius: 15, borderWidth: 2, borderColor: colors.purple, backgroundColor: colors.surface },
});
