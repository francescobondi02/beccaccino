import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Image, Modal, Pressable, ScrollView,
  StyleSheet, Text, View, useWindowDimensions, type ImageSourcePropType,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import ActionButton from '@/components/ActionButton';
import { colors } from '@/constants/theme';
import useReducedMotion from '@/hooks/useReducedMotion';
import { tableLayout } from '@/lib/tableLayout';

const hand = [
  {
    id: 're_coppe', label: 'Re di coppe',
    image: require('../../assets/cards/re_coppe.png'),
    wins: true, title: 'Presa tua.',
    explanation: 'Il re è di coppe, la briscola: batte tutte le altre carte di questa presa. La presa va alla tua squadra.',
  },
  {
    id: 'cavallo_bastoni', label: 'Cavallo di bastoni',
    image: require('../../assets/cards/cavallo_bastoni.png'),
    wins: false, title: 'Presa agli avversari.',
    explanation: 'Il cavallo non è né di denara né di briscola. Vince il due di denara dell’avversario: nel Beccaccino il due batte l’asso.',
  },
] as const;
type HandCardData = typeof hand[number];
type Layout = ReturnType<typeof tableLayout>;
type Point = { x: number; y: number };
type Phase = 'ready' | 'playing' | 'result' | 'complete';

const playedCards = [
  { seat: '1. Avversario', label: 'Asso di denara', image: require('../../assets/cards/asso_denari.png') },
  { seat: '2. Socio', label: 'Tre di spade', image: require('../../assets/cards/tre_spade.png') },
  { seat: '3. Avversario', label: 'Due di denara', image: require('../../assets/cards/due_denari.png') },
];

function HandCard({ card, index, layout, selected, disabled, reduceMotion, onPress }: {
  card: HandCardData; index: number; layout: Layout;
  selected: boolean; disabled: boolean; reduceMotion: boolean; onPress: () => void;
}) {
  const [lift] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const toValue = selected ? -12 : 0;
    if (reduceMotion) {
      lift.setValue(toValue);
      return;
    }
    const animation = Animated.timing(lift, { toValue, duration: 140, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [lift, reduceMotion, selected]);

  return (
    <Animated.View style={[styles.handCard, {
      left: layout.handX[index], top: layout.handY,
      width: layout.handWidth, height: layout.handHeight,
      transform: [{ translateY: lift }, { rotate: index === 0 ? '-7deg' : '7deg' }],
    }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={card.label}
        accessibilityHint="Seleziona questa carta, poi conferma con Gioca"
        accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
        style={({ pressed }) => [styles.cardButton, selected && styles.selectedCard, pressed && styles.pressed]}>
        <Image source={card.image} accessible={false} accessibilityIgnoresInvertColors style={styles.cardImage} />
      </Pressable>
    </Animated.View>
  );
}

function TableCard({ image, label, index, layout, origin, destination, collect, glow, winner, reduceMotion, progress }: {
  image: ImageSourcePropType; label: string; index: number; layout: Layout;
  origin: Point; destination: Point; collect: Animated.Value; glow: Animated.Value;
  winner: boolean; reduceMotion: boolean | null; progress?: Animated.Value;
}) {
  const [entry] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (progress || reduceMotion === null) return;
    if (reduceMotion) {
      entry.setValue(1);
      return;
    }
    const animation = Animated.timing(entry, {
      toValue: 1, duration: 360, delay: index * 120,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entry, index, progress, reduceMotion]);

  const travel = progress ?? entry;
  const target = layout.cards[index];
  const moveX = Animated.add(
    travel.interpolate({ inputRange: [0, 1], outputRange: [origin.x - target.x, 0] }),
    collect.interpolate({ inputRange: [0, 1], outputRange: [0, destination.x - target.x - layout.cardWidth / 2] }),
  );
  const moveY = Animated.add(
    travel.interpolate({ inputRange: [0, 1], outputRange: [origin.y - target.y, 0] }),
    collect.interpolate({ inputRange: [0, 1], outputRange: [0, destination.y - target.y - layout.cardHeight / 2] }),
  );
  const scale = Animated.multiply(
    travel.interpolate({ inputRange: [0, 1], outputRange: [progress ? layout.handWidth / layout.cardWidth : 0.5, 1] }),
    collect.interpolate({ inputRange: [0, 1], outputRange: [1, 0.18] }),
  );

  return (
    <Animated.View accessible accessibilityLabel={label} style={[styles.tableCard, {
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
      <Image source={image} accessible={false} accessibilityIgnoresInvertColors style={styles.cardImage} />
      {winner && <View pointerEvents="none" style={styles.winningCard} />}
    </Animated.View>
  );
}

export default function TutorialScreen() {
  const router = useRouter();
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const accessibleLayout = width < height || fontScale >= 1.4;
  const [board, setBoard] = useState({
    width: width - insets.left - insets.right - 16,
    height: height - insets.top - insets.bottom - 16,
  });
  const layout = tableLayout(board.width, board.height, fontScale >= 1.4);
  const [selected, setSelected] = useState<HandCardData | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [replay, setReplay] = useState(0);
  const reduceMotion = useReducedMotion();
  const [motion] = useState(() => ({
    play: new Animated.Value(0), collect: new Animated.Value(0), glow: new Animated.Value(0),
  }));
  const result = phase === 'ready' ? null : selected;
  const winnerIndex = result?.wins ? 3 : 2;
  const winnerSeat = layout.seats[winnerIndex];
  const destination = { x: winnerSeat.x + layout.seatWidth / 2, y: winnerSeat.y + 16 };

  useEffect(() => {
    if (phase !== 'playing' || !selected) return;
    const animation = Animated.sequence([
      Animated.timing(motion.play, { toValue: 1, duration: reduceMotion !== false ? 0 : 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(motion.glow, { toValue: 1, duration: reduceMotion !== false ? 0 : 240, useNativeDriver: true }),
      Animated.delay(reduceMotion !== false ? 0 : 650),
      Animated.timing(motion.collect, { toValue: 1, duration: reduceMotion !== false ? 0 : 450, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]);
    let active = true;
    animation.start(({ finished }) => {
      if (!active || !finished) return;
      setPhase('result');
      AccessibilityInfo.announceForAccessibility(`${selected.title} ${selected.explanation}`);
    });
    return () => {
      active = false;
      animation.stop();
    };
  }, [motion, phase, reduceMotion, selected]);

  const exit = () => router.canGoBack() ? router.back() : router.replace('/');
  const reset = () => {
    motion.play.setValue(0);
    motion.collect.setValue(0);
    motion.glow.setValue(0);
    setSelected(null);
    setPhase('ready');
    setReplay((value) => value + 1);
  };
  const controls = (
    <View style={[styles.controls, !accessibleLayout && styles.controlsDock]}>
      <Text style={styles.turnLabel}>{phase === 'ready' ? 'TOCCA A TE' : phase === 'playing' ? 'PRESA IN CORSO' : result?.title}</Text>
      <Text style={styles.selection}>{phase === 'ready' ? selected?.label ?? 'Scegli una carta' : 'Briscola: coppe'}</Text>
      {phase === 'result' || phase === 'complete'
        ? <ActionButton label="Riprova la presa" onPress={reset} />
        : <ActionButton label={phase === 'playing' ? 'Un attimo…' : 'Gioca'}
          accessibilityHint={selected ? `Gioca ${selected.label.toLowerCase()}` : 'Prima seleziona una carta'}
          disabled={!selected || phase !== 'ready'}
          onPress={() => {
            if (!selected) return;
            if (reduceMotion !== false) {
              motion.play.setValue(1);
              motion.collect.setValue(1);
              setPhase('result');
              AccessibilityInfo.announceForAccessibility(`${selected.title} ${selected.explanation}`);
            } else setPhase('playing');
          }} />}
    </View>
  );
  const stage = (
    <View testID="table-stage" style={[styles.stage, accessibleLayout && styles.accessibleStage]}
      onLayout={({ nativeEvent: { layout: size } }) => {
        if (size.width > 0 && size.height > 0) setBoard({ width: size.width, height: size.height });
      }}>
      <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
        style={[styles.felt, { bottom: layout.handHeight * 0.35 }]}>
        <View style={styles.feltClipped}>
          <Image source={require('../../assets/table-felt.png')} style={styles.feltImage} />
          <View style={styles.innerRail} />
          <Text style={styles.tableBrand}>BECCA!</Text>
        </View>
      </View>
      <View style={styles.exit}>
        <ActionButton secondary label="Esci" accessibilityHint="Esci dalla prova e torna alla schermata precedente" onPress={exit} />
        <Text style={styles.offline}>PROVA OFFLINE</Text>
      </View>
      <View accessible accessibilityLabel="Briscola: coppe. Seme iniziale: denara." style={styles.trump}>
        <Text style={styles.trumpCaption}>BRISCOLA</Text>
        <Text style={styles.trumpSuit}>COPPE</Text>
      </View>
      {['Avversario', 'Socio', 'Avversario'].map((name, index) => (
        <View key={index} accessible accessibilityLabel={`${playedCards[index].seat}${result && winnerIndex === index ? ', vince la presa' : ''}`}
          style={[styles.seat, {
            left: layout.seats[index].x, top: layout.seats[index].y, width: layout.seatWidth,
          }, index === 1 && styles.partnerSeat, result && winnerIndex === index && styles.winningSeat]}>
          <View style={[styles.seatDot, index === 1 && styles.partnerDot]} />
          <Text style={styles.seatName}>{name}</Text>
        </View>
      ))}
      {playedCards.map((card, index) => (
        <TableCard key={`${replay}-${index}`} image={card.image}
          label={`${card.seat}: ${card.label}${result && winnerIndex === index ? ', vince la presa' : ''}`}
          index={index} layout={layout} reduceMotion={reduceMotion}
          origin={{
            x: layout.seats[index].x + layout.seatWidth / 2 - layout.cardWidth / 2,
            y: layout.seats[index].y + 16 - layout.cardHeight / 2,
          }}
          destination={destination} collect={motion.collect} glow={motion.glow} winner={!!result && winnerIndex === index} />
      ))}
      {result && <TableCard image={result.image} label={`4. Tu: ${result.label}${result.wins ? ', vince la presa' : ''}`}
        index={3} layout={layout} reduceMotion={reduceMotion}
        origin={{
          x: layout.handX[hand.indexOf(result)] + layout.handWidth / 2 - layout.cardWidth / 2,
          y: layout.handY + layout.handHeight / 2 - layout.cardHeight / 2,
        }}
        destination={destination} collect={motion.collect} glow={motion.glow} winner={result.wins} progress={motion.play} />}
      {hand.map((card, index) => card !== result && (
        <HandCard key={card.id} card={card} index={index} layout={layout} selected={selected === card}
          disabled={phase !== 'ready'} reduceMotion={reduceMotion !== false} onPress={() => setSelected(card)} />
      ))}
      <Text style={styles.you}>TU</Text>
      {!accessibleLayout && controls}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.screen} accessibilityElementsHidden={phase === 'result'}
        importantForAccessibility={phase === 'result' ? 'no-hide-descendants' : 'auto'}>
        {accessibleLayout
          ? <ScrollView contentContainerStyle={styles.accessibleContent}>
            <ScrollView horizontal>{stage}</ScrollView>
            {controls}
          </ScrollView>
          : stage}
      </View>
      <Modal testID="trick-result" visible={phase === 'result'} transparent animationType={reduceMotion !== false ? 'none' : 'fade'}
        supportedOrientations={['landscape', 'portrait']} onRequestClose={() => setPhase('complete')}>
        <SafeAreaView style={styles.backdrop}>
          <ScrollView contentContainerStyle={styles.resultContent}>
            <View accessibilityViewIsModal style={styles.resultPanel}>
              <Text style={styles.resultEyebrow}>{result?.wins ? 'LA PRESA È TUA' : 'SI IMPARA GIOCANDO'}</Text>
              <Text accessibilityRole="header" style={styles.resultTitle}>{result?.title}</Text>
              <Text style={styles.explanation}>{result?.explanation}</Text>
              <ActionButton label="Riprova la presa" onPress={reset} />
              <ActionButton secondary label="Esci dalla prova" onPress={exit} />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  stage: { flex: 1, margin: 8 },
  accessibleStage: { flex: 0, width: 640, height: 640 },
  accessibleContent: { flexGrow: 1, paddingBottom: 16 },
  felt: {
    position: 'absolute', top: 16, left: 44, right: 44, borderRadius: 999,
    borderWidth: 5, borderColor: '#7241c6', backgroundColor: '#302045',
    shadowColor: '#a779ff', shadowOpacity: 0.4, shadowRadius: 20, elevation: 5,
  },
  feltClipped: { flex: 1, borderRadius: 999, overflow: 'hidden' },
  feltImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  innerRail: { ...StyleSheet.absoluteFill, margin: 9, borderRadius: 999, borderWidth: 1, borderColor: '#d9ff4370' },
  tableBrand: {
    position: 'absolute', alignSelf: 'center', top: '36%', fontSize: 64,
    fontWeight: '900', fontStyle: 'italic', color: '#ffffff0d', letterSpacing: -4,
  },
  exit: { position: 'absolute', top: 0, left: 0, gap: 5, zIndex: 4 },
  offline: { color: colors.muted, fontSize: 10, fontWeight: '800', textAlign: 'center', letterSpacing: 0.6 },
  trump: { position: 'absolute', right: 0, top: 0, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.primary, zIndex: 4 },
  trumpCaption: { color: colors.background, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  trumpSuit: { color: colors.background, fontSize: 18, fontWeight: '900' },
  seat: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, borderRadius: 16, borderWidth: 1, borderColor: '#9570cc', backgroundColor: colors.surface, zIndex: 2 },
  seatDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.muted },
  partnerDot: { backgroundColor: colors.primary },
  partnerSeat: { borderColor: colors.primary },
  seatName: { flexShrink: 1, color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: '700' },
  winningSeat: { borderColor: colors.primary, borderWidth: 2 },
  tableCard: { position: 'absolute', borderRadius: 7, backgroundColor: '#fffef8', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 4, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  winningCard: { ...StyleSheet.absoluteFill, borderWidth: 3, borderColor: colors.primary, borderRadius: 7 },
  handCard: { position: 'absolute', zIndex: 3, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  cardButton: { flex: 1, minWidth: 48, minHeight: 48, borderRadius: 8, borderWidth: 2, borderColor: '#fffef8', backgroundColor: '#fffef8' },
  selectedCard: { borderColor: colors.primary, borderWidth: 3 },
  pressed: { opacity: 0.8 },
  cardImage: { width: '100%', height: '100%', resizeMode: 'contain', borderRadius: 5 },
  you: { position: 'absolute', bottom: 0, alignSelf: 'center', color: colors.primary, fontSize: 11, fontWeight: '900' },
  controls: { gap: 6, padding: 8 },
  controlsDock: { position: 'absolute', bottom: 0, right: 0, width: 140, zIndex: 4 },
  turnLabel: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  selection: { color: colors.text, fontSize: 14, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: '#08060ddd' },
  resultContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  resultPanel: { width: '100%', maxWidth: 520, alignSelf: 'center', borderRadius: 24, borderWidth: 1, borderColor: '#9570cc', padding: 22, gap: 14, backgroundColor: colors.surface },
  resultEyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  resultTitle: { color: colors.text, fontSize: 28, fontWeight: '900' },
  explanation: { color: colors.text, fontSize: 17, lineHeight: 25 },
});
