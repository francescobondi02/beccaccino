import { useState, type PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

// Games never scroll: content that is taller than the screen is scaled down to fit instead.
export default function FitScreen({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [contentHeight, setContentHeight] = useState(0);
  const scale = box.height && contentHeight > box.height ? box.height / contentHeight : 1;
  return (
    <View style={[styles.box, style]} onLayout={({ nativeEvent: { layout } }) => setBox(layout)}>
      <View testID="fit-content" style={[styles.content, { width: box.width || undefined, transform: [{ scale }] }]}
        onLayout={({ nativeEvent: { layout } }) => setContentHeight(layout.height)}>
        {children}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  box: { flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  content: { flexShrink: 0 },
});
