import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Pressable, StyleSheet, Text, View,
  useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ActionButton from './ActionButton';
import { LastTrickButton, PlayerBadge, ScoreBoard, TrumpBadge } from './Hud';
import CardZoom from './CardZoom';
import TableCard from './TableCard';
import TableFelt from './TableFelt';
import { colors, hard } from '@/constants/theme';
import useCardDrag from '@/hooks/useCardDrag';
import useReducedMotion from '@/hooks/useReducedMotion';
import { cardImage } from '@/lib/cardImages';
import type { Card } from '@contract/cards';
import type { GameState } from '@contract/game';
import { cardKey, cardLabel, displayName, ourSide, relativeSeat, type Trick } from '@/lib/game';
import { touchFeedback } from '@/lib/haptics';
import { playSound } from '@/lib/sound';
import { tableLayout } from '@/lib/tableLayout';

function HandCard({ card, index, count, width, step, selected, legal, disabled, onSelect, onPlay, onDrag, onZoom, reduced }: {
  card: Card; index: number; count: number; width: number; step: number; selected: boolean; legal: boolean;
  disabled: boolean; onSelect: () => void; onPlay: () => Promise<boolean>; onDrag: (active: boolean) => void;
  onZoom: (card: Card | null) => void; reduced: boolean;
}) {
  const playable = legal && !disabled;
  const drag = useCardDrag(playable, onPlay, onDrag);
  const [entry] = useState(() => new Animated.Value(0));
  const [lift] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) { entry.setValue(1); return; }
    const animation = Animated.spring(entry, { toValue: 1, delay: index * 45, damping: 14, stiffness: 180, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [entry, index, reduced]);
  useEffect(() => {
    if (reduced) { lift.setValue(selected ? 1 : 0); return; }
    const animation = Animated.spring(lift, { toValue: selected ? 1 : 0, damping: 14, stiffness: 260, mass: 0.6, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [lift, reduced, selected]);
  const offset = index - (count - 1) / 2;
  return (
    <Animated.View {...drag.handlers} style={[styles.handSlot, { left: index * step, width, height: width / 0.63,
      zIndex: selected ? 20 : index, transform: drag.offset.getTranslateTransform() }]}>
    <Animated.View style={[styles.fill, { transform: [
        { translateY: Animated.add(entry.interpolate({ inputRange: [0, 1], outputRange: [90, offset * offset * 0.9] }),
          lift.interpolate({ inputRange: [0, 1], outputRange: [0, -20] })) },
        { rotate: `${offset * 2.6}deg` },
        { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
      ] }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={cardLabel(card)}
        accessibilityHint={legal ? (selected ? 'Tocca di nuovo per giocarla' : 'Seleziona, poi tocca di nuovo o premi Gioca') : 'Questa carta non è giocabile adesso'}
        accessibilityState={{ selected, disabled: !playable }} delayLongPress={280}
        onPress={() => { if (!playable) return; if (selected) void onPlay(); else { touchFeedback(); onSelect(); } }}
        onLongPress={() => { touchFeedback(); onZoom(card); }} onPressOut={() => onZoom(null)}
        style={({ pressed }) => [styles.handCard, selected && styles.selected, pressed && styles.pressed]}>
        <Image source={cardImage(card)} accessible={false} accessibilityIgnoresInvertColors style={styles.image} />
        {!legal && !disabled && <View pointerEvents="none" style={styles.unplayable} />}
      </Pressable>
    </Animated.View>
    </Animated.View>
  );
}

export default function LiveTable({ game, userId, selected, disabled, onSelect,
  onPlay, onMenu, onHistory, controls, prompt, completedTrick, onCollected, hidden }: {
  game: GameState; userId: number; selected: Card | null; disabled: boolean;
  onSelect: (card: Card) => void; onPlay: (card: Card) => Promise<boolean>; onMenu: () => void; onHistory: () => void; controls: ReactNode; prompt: ReactNode;
  completedTrick: Trick | null; onCollected: () => void; hidden: boolean;
}) {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ width: width - insets.left - insets.right - 16, height: height - insets.top - insets.bottom - 16 });
  const layout = tableLayout(size.width, size.height, fontScale >= 1.4);
  const motionPreference = useReducedMotion();
  const reduced = motionPreference !== false;
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState<Card | null>(null);
  // A held card can leave the hand (e.g. auto-played) without a press-out: drop its preview.
  if (zoom && !game.myHand.some((card) => cardKey(card) === cardKey(zoom))) setZoom(null);
  const [motion] = useState(() => ({ collect: new Animated.Value(0), glow: new Animated.Value(0) }));
  const { players, playableCards: playable, score } = game;
  const position = (playerId: number) => relativeSeat(players, playerId, userId);
  const nameOf = (playerId: number) => displayName(players.find((p) => p.userId === playerId)?.username ?? '');
  const [us, them] = ourSide<[number, number]>(players, userId, [score.team0.points, score.team0.figures], [score.team1.points, score.team1.figures]);
  const winner = completedTrick ? players.find((p) => p.userId === completedTrick.winnerUserId) : null;
  const winnerName = winner ? displayName(winner.username) : 'un giocatore';
  const winnerSeat = layout.seats[winner ? position(winner.userId) : 3];
  const cards = completedTrick?.cards ?? game.trick?.cards ?? [];
  const tableCount = game.trick?.cards.length ?? 0;
  useEffect(() => { if (tableCount > 0) playSound('card'); }, [tableCount]);
  useEffect(() => {
    motion.collect.setValue(0);
    motion.glow.setValue(0);
    if (!completedTrick) return;
    AccessibilityInfo.announceForAccessibility(`Presa a ${winnerName}`);
    playSound('trick');
    const animation = Animated.sequence([
      Animated.delay(reduced ? 350 : 600),
      Animated.timing(motion.glow, { toValue: 1, duration: reduced ? 0 : 220, useNativeDriver: true }),
      Animated.timing(motion.collect, { toValue: 1, duration: reduced ? 0 : 450,
        easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]);
    let active = true;
    animation.start(({ finished }) => { if (finished && active) onCollected(); });
    return () => { active = false; animation.stop(); };
  }, [completedTrick, motion, reduced, onCollected, winnerName]);

  const handSpace = size.width - 216;
  const count = game.myHand.length;
  const step = count > 1 ? Math.min(layout.handWidth * 0.74, (handSpace - layout.handWidth) / (count - 1)) : 0;
  const fanWidth = layout.handWidth + step * Math.max(0, count - 1);
  const board = (
    <View testID="live-table-stage" style={styles.stage}
      onLayout={({ nativeEvent: { layout } }) => { if (layout.width && layout.height) setSize(layout); }}>
      <TableFelt bottom={layout.handHeight * 0.45} />
      <View style={styles.topLeft}>
        <ActionButton compact secondary label={game.isPractice ? "Pausa / menu" : "Menu"} glyph={game.isPractice ? "II" : "☰"} onPress={onMenu} />
        <ScoreBoard us={us} them={them} />
        {game.lastTrick && <LastTrickButton trick={game.lastTrick} onPress={onHistory} />}
      </View>
      <View style={styles.topRight}>
        <TrumpBadge suit={game.round.briscola} round={game.round.number} cricca={game.round.cricca} />
      </View>
      {players.filter((p) => p.userId !== userId).map((player) => {
        const index = position(player.userId);
        const active = game.turn?.userId === player.userId;
        const signal = cards.find((card) => card.userId === player.userId)?.signal;
        return (
          <View key={player.userId} accessible accessibilityLabel={`${index === 1 ? 'Socio' : 'Avversario'} ${nameOf(player.userId)}${active ? ', sta giocando' : ''}${signal ? `, ${signal}` : ''}`}
            style={[styles.seat, { left: layout.seats[index].x, top: layout.seats[index].y, width: layout.seatWidth }]}>
            <PlayerBadge name={nameOf(player.userId)} partner={index === 1} active={active} highlighted={winner?.userId === player.userId}
              signal={signal} bot={player.botModel !== null}
              reduced={reduced} />
          </View>
        );
      })}
      {cards.map((card) => {
        const index = position(card.userId);
        const seat = layout.seats[index];
        return <TableCard key={`${completedTrick?.roundNumber ?? game.round.number}:${completedTrick?.trickNumber ?? game.trick?.number}:${cardKey(card)}`}
          image={cardImage(card)} label={`${nameOf(card.userId)}: ${cardLabel(card)}${card.signal ? `, ${card.signal}` : ''}`}
          index={index} layout={layout} origin={{ x: seat.x + layout.seatWidth / 2, y: seat.y + 20 }} reduceMotion={motionPreference}
          destination={{ x: winnerSeat.x + layout.seatWidth / 2, y: winnerSeat.y + 20 }}
          collect={motion.collect} glow={motion.glow} winner={card.userId === winner?.userId} />;
      })}
      {dragging && <View pointerEvents="none" style={[styles.dropZone, { left: layout.cards[0].x - 16, top: layout.cards[1].y - 12,
        width: layout.cards[2].x + layout.cardWidth - layout.cards[0].x + 32, height: layout.cards[3].y + layout.cardHeight - layout.cards[1].y + 24 }]}>
        <Text style={styles.dropText}>RILASCIA PER GIOCARE</Text>
      </View>}
      {prompt && <View style={[styles.promptSlot, { bottom: layout.handHeight + 18, left: 8, width: handSpace }]}>{prompt}</View>}
      <View accessibilityLabel="Le tue carte" style={[styles.hand, { left: 8 + (handSpace - fanWidth) / 2, width: fanWidth, height: layout.handHeight }]}>
        {game.myHand.map((card, index) => <HandCard key={`${game.round.number}:${cardKey(card)}`}
          card={card} index={index} count={count} width={layout.handWidth} step={step}
          selected={selected !== null && cardKey(selected) === cardKey(card)}
          legal={playable.some((legal) => cardKey(legal) === cardKey(card))} disabled={disabled}
          reduced={reduced} onSelect={() => onSelect(card)} onPlay={() => onPlay(card)}
          onDrag={setDragging} onZoom={setZoom} />)}
      </View>
      <View style={styles.controls}>{controls}</View>
      <CardZoom card={zoom} reduced={reduced}
        note={zoom && !disabled ? playable.some((c) => cardKey(c) === cardKey(zoom)) ? 'GIOCABILE' : 'NON GIOCABILE ORA' : undefined} />
    </View>
  );
  return (
    <SafeAreaView style={styles.screen} accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
      {board}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, stage: { flex: 1, margin: 8 },
  topLeft: { position: 'absolute', top: 0, left: 0, zIndex: 4, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  topRight: { position: 'absolute', top: 2, right: 6, zIndex: 4 },
  seat: { position: 'absolute', alignItems: 'center', zIndex: 3 },
  promptSlot: { position: 'absolute', alignItems: 'center', zIndex: 5 },
  hand: { position: 'absolute', bottom: 0, zIndex: 6 },
  handSlot: { position: 'absolute', bottom: 0 },
  fill: { flex: 1 },
  dropZone: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 3,
    borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: '#d9ff4318', zIndex: 2 },
  dropText: { color: colors.primary, fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  handCard: { flex: 1, borderRadius: 7, borderWidth: 2, borderColor: colors.ink, backgroundColor: '#fffef8',
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 4, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  selected: { borderColor: colors.primary, borderWidth: 3, ...hard(colors.purple, 4) },
  unplayable: { ...StyleSheet.absoluteFill, borderRadius: 5, backgroundColor: '#100a1caa' },
  pressed: { transform: [{ scale: 0.95 }] },
  image: { width: '100%', height: '100%', resizeMode: 'contain', borderRadius: 5 },
  controls: { position: 'absolute', right: 0, bottom: 0, width: 200, gap: 6, zIndex: 7, alignItems: 'stretch' },
});
