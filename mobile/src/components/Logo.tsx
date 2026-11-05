import { Image, StyleSheet, Text, View } from 'react-native';
import Offset from './Offset';
import { colors } from '@/constants/theme';

// The website header brand: tilted acid tile with the bolt, BECCA wordmark and tagline.
export default function Logo({ size = 44, tagline = true }: { size?: number; tagline?: boolean }) {
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="BECCA" style={styles.brand}>
      <View style={styles.tilt}>
        <Offset color="#d9ff4340" depth={3} radius={size * 0.25}>
          <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.25 }]}>
            <Image source={require('../../assets/bolt.png')} style={{ width: size * 0.58, height: size * 0.58 }} />
          </View>
        </Offset>
      </View>
      <View>
        <Text style={[styles.word, { fontSize: size * 0.72, lineHeight: size * 0.75 }]}>BECCA</Text>
        {tagline && <Text style={styles.tagline}>VECCHIA SCUOLA. NUOVA ENERGIA.</Text>}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tile: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.ink,
    backgroundColor: colors.primary },
  tilt: { transform: [{ rotate: '-10deg' }] },
  word: { color: colors.text, fontWeight: '900', fontStyle: 'italic', letterSpacing: -2.5 },
  tagline: { marginTop: 3, color: colors.muted, fontSize: 7, fontWeight: '700', letterSpacing: 1 },
});
