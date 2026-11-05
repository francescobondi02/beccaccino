import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Animated, AppState, Easing, Image, Pressable, StyleSheet, View } from 'react-native';

import useReducedMotion from '@/hooks/useReducedMotion';

const cards = [
  require('../../assets/cards/asso_denari.png'),
  require('../../assets/cards/tre_spade.png'),
  require('../../assets/cards/re_coppe.png'),
  require('../../assets/cards/cavallo_bastoni.png'),
  require('../../assets/cards/due_denari.png'),
];

export default function HomeCardFan({ height }: { height: number }) {
  const [width, setWidth] = useState(0);
  const [float] = useState(() => new Animated.Value(0));
  const [touch] = useState(() => new Animated.Value(0));
  const reduceMotion = useReducedMotion();
  const cardHeight = Math.min(height * 0.72, width * 0.43);
  const cardWidth = cardHeight * 0.63;

  useFocusEffect(useCallback(() => {
    if (reduceMotion !== false) return;
    let animation: Animated.CompositeAnimation | undefined;
    const stop = () => {
      animation?.stop();
      animation = undefined;
      float.setValue(0);
      touch.setValue(0);
    };
    const update = (state: typeof AppState.currentState) => {
      stop();
      if (state !== 'active') return;
      animation = Animated.loop(Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
        Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      ]));
      animation.start();
    };
    update(AppState.currentState);
    const subscription = AppState.addEventListener('change', update);
    return () => {
      subscription.remove();
      stop();
    };
  }, [float, reduceMotion, touch]));

  const tilt = (toValue: number) => {
    if (reduceMotion !== false) return;
    Animated.spring(touch, { toValue, stiffness: 110, damping: 18, mass: 1, useNativeDriver: true, isInteraction: false }).start();
  };

  return (
    <View testID="home-card-artwork" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.scene, { height }]} onLayout={({ nativeEvent: { layout } }) => setWidth(layout.width)}>
      <Pressable testID="home-card-touch" accessible={false} focusable={false}
        onPressIn={() => tilt(1)} onPressOut={() => tilt(0)} style={StyleSheet.absoluteFill}>
        {width > 0 && <>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {
            transform: [
              { perspective: 700 },
              { rotateX: touch.interpolate({ inputRange: [0, 1], outputRange: ['-7deg', '6deg'] }) },
              { rotateY: touch.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '8deg'] }) },
            ],
          }]}>
            {cards.map((source, index) => (
              <Animated.View key={index} testID="home-card" style={[styles.card, {
                width: cardWidth, height: cardHeight,
                left: (width - cardWidth) / 2 + (index - 2) * cardWidth * 0.42,
                top: height * (0.1 + Math.abs(index - 2) * 0.025),
                zIndex: 5 - Math.abs(index - 2),
                transform: [
                  { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, (index % 2 ? 1 : -1) * height * 0.02] }) },
                  { rotate: `${(index - 2) * 16}deg` },
                ],
              }]}>
                <Image source={source} accessible={false} accessibilityIgnoresInvertColors style={styles.face} />
              </Animated.View>
            ))}
          </Animated.View>
        </>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { width: '100%', maxWidth: 360 },
  card: {
    position: 'absolute', borderRadius: 8, borderWidth: 2, borderColor: '#fff', backgroundColor: '#fff',
    shadowColor: '#1d123a', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.45, shadowRadius: 0,
    elevation: 8,
  },
  face: { width: '100%', height: '100%', borderRadius: 6 },
});
