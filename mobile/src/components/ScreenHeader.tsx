import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import ActionButton from './ActionButton';
import Logo from './Logo';
import { colors, fonts } from '@/constants/theme';

// Shared top bar for secondary screens, in the website's header language.
export default function ScreenHeader({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <ActionButton compact secondary label="Indietro" glyph="‹"
        onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />
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
