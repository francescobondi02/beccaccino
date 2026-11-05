import { useEffect, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Image, Modal, Pressable,
  StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import ActionButton from '@/components/ActionButton';
import FitScreen from '@/components/FitScreen';
import { PlayerBadge, TrumpBadge } from '@/components/Hud';
import Panel from '@/components/Panel';
import TableCard from '@/components/TableCard';
import TableFelt from '@/components/TableFelt';
import { colors, fonts, hard, shared } from '@/constants/theme';
import useCardDrag from '@/hooks/useCardDrag';
import useCloseOrHome from '@/hooks/useCloseOrHome';
import useReducedMotion from '@/hooks/useReducedMotion';
import { playSound } from '@/lib/sound';
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
type Phase = 'ready' | 'playing' | 'result' | 'complete';

const playedCards = [
  { seat: '1. Avversario', label: 'Asso di denara', image: require('../../assets/cards/asso_denari.png') },
  { seat: '2. Socio', label: 'Tre di spade', image: require('../../assets/cards/tre_spade.png') },
  { seat: '3. Avversario', label: 'Due di denara', image: require('../../assets/cards/due_denari.png') },
];

function HandCard({ card, index, layout, selected, disabled, reduceMotion, onPress, onDrop }: {
  card: HandCardData; index: number; layout: Layout;
  selected: boolean; disabled: boolean; reduceMotion: boolean; onPress: () => void; onDrop: () => Promise<boolean>;
}) {
  const drag = useCardDrag(!disabled, onDrop);
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
    <Animated.View {...drag.handlers} style={[styles.handCard, {
      left: layout.handX[index], top: layout.handY,
      width: layout.handWidth, height: layout.handHeight,
      transform: drag.offset.getTranslateTransform(),
    }]}>
    <Animated.View style={[styles.fill, { transform: [{ translateY: lift }, { rotate: index === 0 ? '-7deg' : '7deg' }] }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={card.label}
        accessibilityHint={selected ? 'Tocca di nuovo per giocarla' : 'Seleziona, poi tocca di nuovo o premi Gioca'}
        accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
        style={({ pressed }) => [styles.cardButton, selected && styles.selectedCard, pressed && styles.pressed]}>
        <Image source={card.image} accessible={false} accessibilityIgnoresInvertColors style={styles.cardImage} />
      </Pressable>
    </Animated.View>
    </Animated.View>
  );
}

export default function TutorialScreen() {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [board, setBoard] = useState({
    width: width - insets.left - insets.right - 16,
    height: height - insets.top - insets.bottom - 16,
  });
  const layout = tableLayout(board.width, board.height, fontScale >= 1.4);
  const [selected, setSelected] = useState<HandCardData | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [replay, setReplay] = useState(0);
  const motionPreference = useReducedMotion();
  const reduceMotion = motionPreference !== false;
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
      Animated.timing(motion.play, { toValue: 1, duration: reduceMotion ? 0 : 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(motion.glow, { toValue: 1, duration: reduceMotion ? 0 : 240, useNativeDriver: true }),
      Animated.delay(reduceMotion ? 0 : 650),
      Animated.timing(motion.collect, { toValue: 1, duration: reduceMotion ? 0 : 450, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]);
    let active = true;
    animation.start(({ finished }) => {
      if (!active || !finished) return;
      if (selected.wins) playSound('trick');
      setPhase('result');
      AccessibilityInfo.announceForAccessibility(`${selected.title} ${selected.explanation}`);
    });
    return () => {
      active = false;
      animation.stop();
    };
  }, [motion, phase, reduceMotion, selected]);

  const exit = useCloseOrHome();
  const reset = () => {
    motion.play.setValue(0);
    motion.collect.setValue(0);
    motion.glow.setValue(0);
    setSelected(null);
    setPhase('ready');
    setReplay((value) => value + 1);
  };
  const play = async (card = selected) => {
    if (!card || phase !== 'ready') return false;
    setSelected(card);
    playSound('card');
    if (reduceMotion) {
      motion.play.setValue(1);
      motion.collect.setValue(1);
      setPhase('result');
      AccessibilityInfo.announceForAccessibility(`${card.title} ${card.explanation}`);
    } else setPhase('playing');
    return true;
  };
  const controls = (
    <View style={[styles.controls, styles.controlsDock]}>
      <Text style={styles.turnLabel}>{phase === 'ready' ? 'TOCCA A TE' : phase === 'playing' ? 'PRESA IN CORSO' : result?.title}</Text>
      <Text style={styles.selection}>{phase === 'ready' ? selected ? 'Tocca di nuovo la carta o premi Gioca' : 'Trascina una carta sul tavolo, o toccala' : 'Briscola: coppe'}</Text>
      {phase === 'result' || phase === 'complete'
        ? <ActionButton label="Riprova la presa" onPress={reset} />
        : <ActionButton label={phase === 'playing' ? 'Un attimo…' : 'Gioca'}
          accessibilityHint={selected ? `Gioca ${selected.label.toLowerCase()}` : 'Prima seleziona una carta'}
          disabled={!selected || phase !== 'ready'}
          onPress={() => void play()} />}
    </View>
  );
  const stage = (
    <View testID="table-stage" style={styles.stage}
      onLayout={({ nativeEvent: { layout: size } }) => {
        if (size.width > 0 && size.height > 0) setBoard({ width: size.width, height: size.height });
      }}>
      <TableFelt bottom={layout.handHeight * 0.35} />
      <View style={styles.exit}>
        <ActionButton compact secondary label="Esci" glyph="‹" accessibilityHint="Esci dalla prova e torna alla schermata precedente" onPress={exit} />
        <Text style={styles.offline}>PROVA GUIDATA</Text>
      </View>
      <View style={styles.trump}><TrumpBadge suit="coppe" round={1} cricca={false} /></View>
      {['Avversario', 'Socio', 'Avversario'].map((name, index) => (
        <View key={index} accessible accessibilityLabel={`${playedCards[index].seat}${result && winnerIndex === index ? ', vince la presa' : ''}`}
          style={[styles.seat, { left: layout.seats[index].x, top: layout.seats[index].y, width: layout.seatWidth }]}>
          <PlayerBadge name={name} partner={index === 1} active={false} highlighted={!!result && winnerIndex === index}
            signal={null} bot={false} reduced />
        </View>
      ))}
      {playedCards.map((card, index) => (
        <TableCard key={`${replay}-${index}`} image={card.image}
          label={`${card.seat}: ${card.label}${result && winnerIndex === index ? ', vince la presa' : ''}`}
          index={index} layout={layout} reduceMotion={motionPreference}
          origin={{ x: layout.seats[index].x + layout.seatWidth / 2, y: layout.seats[index].y + 16 }}
          destination={destination} collect={motion.collect} glow={motion.glow} winner={!!result && winnerIndex === index} />
      ))}
      {result && <TableCard image={result.image} label={`4. Tu: ${result.label}${result.wins ? ', vince la presa' : ''}`}
        index={3} layout={layout} reduceMotion={motionPreference}
        origin={{
          x: layout.handX[hand.indexOf(result)] + layout.handWidth / 2,
          y: layout.handY + layout.handHeight / 2,
        }}
        destination={destination} collect={motion.collect} glow={motion.glow} winner={result.wins} progress={motion.play} />}
      {hand.map((card, index) => card !== result && (
        <HandCard key={card.id} card={card} index={index} layout={layout} selected={selected === card}
          disabled={phase !== 'ready'} reduceMotion={reduceMotion}
          onPress={() => selected === card ? void play() : setSelected(card)} onDrop={() => play(card)} />
      ))}
      <Text style={styles.you}>TU</Text>
      {controls}
    </View>
  );

  return (
    <SafeAreaView style={shared.screen}>
      <View style={shared.screen} accessibilityElementsHidden={phase === 'result'}
        importantForAccessibility={phase === 'result' ? 'no-hide-descendants' : 'auto'}>
        {stage}
      </View>
      <Modal testID="trick-result" visible={phase === 'result'} transparent animationType={reduceMotion ? 'none' : 'fade'}
        supportedOrientations={['landscape', 'portrait']} onRequestClose={() => setPhase('complete')}>
        <SafeAreaView style={styles.backdrop}>
          <FitScreen>
          <View style={styles.resultContent}>
            <View accessibilityViewIsModal style={styles.resultWrap}><Panel>
              <Text style={shared.eyebrow}>{result?.wins ? 'LA PRESA È TUA' : 'SI IMPARA GIOCANDO'}</Text>
              <Text accessibilityRole="header" style={styles.resultTitle}>{result?.title}</Text>
              <Text style={styles.explanation}>{result?.explanation}</Text>
              <ActionButton label="Riprova la presa" onPress={reset} />
              <ActionButton secondary label="Esci dalla prova" onPress={exit} />
            </Panel></View>
          </View>
          </FitScreen>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, margin: 8 },
  exit: { position: 'absolute', top: 0, left: 0, gap: 5, zIndex: 4, alignItems: 'flex-start' },
  offline: { color: colors.muted, fontSize: 10, fontWeight: '800', textAlign: 'center', letterSpacing: 0.6 },
  trump: { position: 'absolute', right: 6, top: 2, zIndex: 4 },
  seat: { position: 'absolute', alignItems: 'center', zIndex: 2 },
  fill: { flex: 1 },
  handCard: { position: 'absolute', zIndex: 3, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  cardButton: { flex: 1, minWidth: 48, minHeight: 48, borderRadius: 7, borderWidth: 2, borderColor: colors.ink, backgroundColor: '#fffef8' },
  selectedCard: { borderColor: colors.primary, borderWidth: 3, ...hard(colors.purple, 4) },
  pressed: { opacity: 0.8 },
  cardImage: { width: '100%', height: '100%', resizeMode: 'contain', borderRadius: 5 },
  you: { position: 'absolute', bottom: 0, alignSelf: 'center', color: colors.primary, fontSize: 11, fontWeight: '900' },
  controls: { gap: 6, padding: 8 },
  controlsDock: { position: 'absolute', bottom: 0, right: 0, width: 200, zIndex: 4 },
  turnLabel: { ...fonts.display, color: colors.primary, fontSize: 18, letterSpacing: -0.5 },
  selection: { ...fonts.body, color: colors.muted, fontSize: 13, lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: '#08060dd9' },
  resultContent: { padding: 20 },
  resultWrap: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  resultTitle: { ...fonts.display, color: colors.primary, fontSize: 28 },
  explanation: { ...fonts.body, color: colors.text, fontSize: 16, lineHeight: 24 },
});
