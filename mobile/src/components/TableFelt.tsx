import { Image, StyleSheet, Text, View } from 'react-native';

export default function TableFelt({ bottom }: { bottom: number }) {
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.felt, { bottom }]}>
      <View style={styles.clipped}>
        <Image source={require('../../assets/table-felt.png')} style={styles.image} />
        <View style={styles.rail} />
        <Text style={styles.brand}>BECCA!</Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  felt: { position: 'absolute', top: 16, left: 44, right: 44, borderRadius: 999,
    borderWidth: 5, borderColor: '#7241c6', backgroundColor: '#302045',
    shadowColor: '#a779ff', shadowOpacity: 0.4, shadowRadius: 20, elevation: 5 },
  clipped: { flex: 1, borderRadius: 999, overflow: 'hidden' },
  image: { width: '100%', height: '100%', resizeMode: 'cover' },
  rail: { ...StyleSheet.absoluteFill, margin: 9, borderRadius: 999, borderWidth: 1, borderColor: '#d9ff4370' },
  brand: { position: 'absolute', alignSelf: 'center', top: '36%', fontSize: 64,
    fontWeight: '900', fontStyle: 'italic', color: '#ffffff0d', letterSpacing: -4 },
});
