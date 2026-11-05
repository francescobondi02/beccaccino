import { useEffect, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { colors } from '@/constants/theme';
import type { tableLayout } from '@/lib/tableLayout';

type Point = { x: number; y: number };
export default function TableCard({ image, label, index, layout, origin, destination, collect, glow, winner, reduceMotion, progress }: {
  image: ImageSourcePropType; label: string; index: number; layout: ReturnType<typeof tableLayout>;
  origin: Point; destination: Point; collect: Animated.Value; glow: Animated.Value;
  winner: boolean; reduceMotion: boolean | null; progress?: Animated.Value;
}) {
  const [entry] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (progress || reduceMotion === null) return;
    if (reduceMotion) { entry.setValue(1); return; }
    const animation = Animated.timing(entry, {
      toValue: 1, duration: 360, delay: index * 120,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entry, index, progress, reduceMotion]);
  const travel = progress ?? entry;
  // `origin` and `destination` are centre points; the card rests with its top-left at `target`.
  const target = layout.cards[index];
  const centreX = target.x + layout.cardWidth / 2;
  const centreY = target.y + layout.cardHeight / 2;
  const moveX = Animated.add(
    travel.interpolate({ inputRange: [0, 1], outputRange: [origin.x - centreX, 0] }),
    collect.interpolate({ inputRange: [0, 1], outputRange: [0, destination.x - centreX] }),
  );
  const moveY = Animated.add(
    travel.interpolate({ inputRange: [0, 1], outputRange: [origin.y - centreY, 0] }),
    collect.interpolate({ inputRange: [0, 1], outputRange: [0, destination.y - centreY] }),
  );
  const scale = Animated.multiply(
    travel.interpolate({ inputRange: [0, 1], outputRange: [progress ? layout.handWidth / layout.cardWidth : 0.5, 1] }),
    collect.interpolate({ inputRange: [0, 1], outputRange: [1, 0.18] }),
  );
  return (
    <Animated.View accessible accessibilityLabel={label} style={[styles.card, {
      left: target.x, top: target.y, width: layout.cardWidth, height: layout.cardHeight,
      opacity: Animated.multiply(
        travel.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 1, 1] }),
        collect.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      ),
      transform: [
        { translateX: moveX }, { translateY: moveY },
        { rotate: travel.interpolate({ inputRange: [0, 1], outputRange: [index % 2 ? '12deg' : '-12deg', index % 2 ? '3deg' : '-3deg'] }) },
        { scale: winner ? Animated.multiply(scale, glow.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.12, 1] })) : scale },
      ],
    }]}>
      <Image source={image} accessible={false} accessibilityIgnoresInvertColors style={styles.image} />
      {winner && <View pointerEvents="none" style={styles.winner} />}
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  card: { position: 'absolute', borderRadius: 7, backgroundColor: '#fffef8', shadowColor: '#000',
    shadowOpacity: 0.35, shadowRadius: 4, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  image: { width: '100%', height: '100%', resizeMode: 'contain', borderRadius: 5 },
  winner: { ...StyleSheet.absoluteFill, borderWidth: 3, borderColor: colors.primary, borderRadius: 7 },
});
