import { StyleSheet, Text, View } from 'react-native';
import ActionButton from './ActionButton';
import Logo from './Logo';
import { colors, fonts } from '@/constants/theme';
import useCloseOrHome from '@/hooks/useCloseOrHome';

// Shared top bar for secondary screens, in the website's header language.
export default function ScreenHeader({ title }: { title: string }) {
  const close = useCloseOrHome();
  return (
    <View style={styles.header}>
      <ActionButton compact secondary label="Indietro" glyph="‹"
        onPress={close} />
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{title.toUpperCase()}</Text>
      <Logo size={30} tagline={false} />
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { ...fonts.display, flex: 1, color: colors.text, fontSize: 22 },
});
