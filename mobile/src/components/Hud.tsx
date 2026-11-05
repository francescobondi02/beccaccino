import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, hard } from '@/constants/theme';
import { cardImage } from '@/lib/cardImages';
import type { Announcement } from '@/hooks/useGameAnnouncements';
import { cardKey, cardLabel, signalIcons, type Room, type Suit, type Trick } from '@/lib/game';
import { touchFeedback } from '@/lib/haptics';
import { playSound } from '@/lib/sound';

const teamColors = { us: colors.primary, them: colors.pink } as const;
const outline = colors.ink;

function Shield({ label, points, figures, color, ink, tilt }: {
  label: string; points: number; figures: number; color: string; ink: string; tilt: string;
}) {
  return (
    <View style={[styles.shield, { backgroundColor: color, transform: [{ rotate: tilt }] }]}>
      <Text style={[styles.shieldLabel, { color: ink }]}>{label}</Text>
      <Text style={[styles.shieldPoints, { color: ink }]}>{points}</Text>
      <View style={styles.pips}>{[0, 1].map((i) =>
        <View key={i} style={[styles.pip, { borderColor: ink }, i < figures && { backgroundColor: ink }]} />)}</View>
    </View>
  );
}

export function ScoreBoard({ us, them }: { us: [number, number]; them: [number, number] }) {
  return (
    <View accessible accessibilityLabel={`Noi ${us[0]} punti e ${us[1]} figure, loro ${them[0]} punti e ${them[1]} figure`} style={styles.board}>
      <Shield label="NOI" points={us[0]} figures={us[1]} color={teamColors.us} ink={colors.ink} tilt="-4deg" />
      <Text style={styles.versus}>VS</Text>
      <Shield label="LORO" points={them[0]} figures={them[1]} color={teamColors.them} ink={colors.ink} tilt="4deg" />
    </View>
  );
}

export function TrumpBadge({ suit, round, cricca }: { suit: Suit | null; round: number; cricca: boolean }) {
  return (
    <View accessible accessibilityLabel={`Briscola ${suit ?? 'da scegliere'}, mano ${round}${cricca ? ', cricca' : ''}`} style={styles.trump}>
      <View style={styles.trumpCard}>
        {suit ? <Image source={cardImage({ suit, value: 'asso' })} style={styles.trumpImage} />
          : <Text style={styles.trumpUnknown}>?</Text>}
      </View>
      <View style={styles.ribbon}><Text style={styles.ribbonText}>{suit?.toUpperCase() ?? 'BRISCOLA?'}</Text></View>
      <Text style={styles.round}>MANO {round}{cricca ? ' · CRICCA' : ''}</Text>
    </View>
  );
}

export function PlayerBadge({ name, partner, active, highlighted, signal, bot, reduced }: {
  name: string; partner: boolean; active: boolean; highlighted: boolean; signal: string | null | undefined;
  bot: boolean; reduced: boolean;
}) {
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    pulse.setValue(0);
    if (!active || reduced) return;
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [active, pulse, reduced]);
  const ring = partner ? teamColors.us : teamColors.them;
  return (
    <View style={styles.player}>
      {active && <Animated.View pointerEvents="none" style={[styles.pulse, { borderColor: ring,
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }] }]} />}
      <View style={[styles.avatar, { borderColor: ring }, (active || highlighted) && styles.avatarActive]}>
        <Text style={styles.initial}>{name.slice(0, 1).toUpperCase()}</Text>
        {bot && <View style={styles.botTag}><Text style={styles.botText}>BOT</Text></View>}
      </View>
      <View style={[styles.plate, active && { backgroundColor: ring }]}>
        <Text numberOfLines={1} style={[styles.plateText, active && styles.plateTextActive]}>{name}</Text>
      </View>
      {signal && <View style={styles.bubble}><Text style={styles.bubbleText}>{signal.toUpperCase()}!</Text></View>}
    </View>
  );
}

export function TimerBadge({ seconds }: { seconds: number }) {
  const urgent = seconds <= 10;
  return (
    <View accessible accessibilityLabel={`${seconds} secondi`} style={[styles.timer, urgent && styles.timerUrgent]}>
      <Text style={styles.timerText}>{seconds}</Text>
    </View>
  );
}

// Centre-screen game announcement: pops in, holds, then floats away. A sticky text stays until cleared.
export function CenterToast({ message, sticky, onDone, reduced }: {
  message: Announcement | null; sticky: string | null; onDone: () => void; reduced: boolean;
}) {
  const [motion] = useState(() => new Animated.Value(0));
  const text = sticky ?? message?.text;
  const tone = sticky ? 'info' : message?.tone;
  useEffect(() => {
    if (sticky || !message) return;
    AccessibilityInfo.announceForAccessibility(message.text);
    if (message.tone !== 'info') touchFeedback(message.tone === 'signal' ? 'play' : 'selection');
    if (message.tone === 'hot') playSound('turn');
    motion.setValue(reduced ? 1 : 0);
    const animation = Animated.sequence([
      Animated.spring(motion, { toValue: 1, damping: 9, stiffness: 240, mass: 0.6, useNativeDriver: true }),
      Animated.delay(reduced ? 1400 : 850),
      Animated.timing(motion, { toValue: 2, duration: reduced ? 0 : 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => { if (finished) onDone(); });
    return () => animation.stop();
  }, [message, motion, onDone, reduced, sticky]);
  useEffect(() => { if (sticky) motion.setValue(1); }, [motion, sticky]);
  if (!text) return null;
  return (
    <View pointerEvents="none" style={styles.toastLayer}>
      <Animated.View style={[styles.toast, tone === 'hot' && styles.toastHot, tone === 'signal' && styles.toastSignal, {
        opacity: motion.interpolate({ inputRange: [0, 0.3, 1, 2], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateY: motion.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, -36] }) },
          { scale: motion.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 1, 1.08] }) },
          { rotate: tone === 'signal' && !reduced
            ? motion.interpolate({ inputRange: [0, 0.4, 0.7, 1, 2], outputRange: ['-14deg', '8deg', '-6deg', '-3deg', '-3deg'] }) : '-3deg' },
        ] }]}>
        <Text accessibilityLiveRegion="assertive" numberOfLines={1} adjustsFontSizeToFit style={[styles.toastText, tone === 'hot' && styles.toastTextHot]}>{text}</Text>
      </Animated.View>
    </View>
  );
}

export function LastTrickButton({ trick, onPress }: { trick: Trick; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Ultima presa" onPress={() => { touchFeedback(); onPress(); }}
      style={({ pressed }) => [styles.lastTrick, pressed && styles.lastTrickPressed]}>
      <View style={styles.miniFan}>
        {trick.cards.map((card, index) => <Image key={cardKey(card)} source={cardImage(card)}
          style={[styles.miniCard, { left: index * 9, transform: [{ rotate: `${(index - 1.5) * 9}deg` }] }]} />)}
      </View>
      <Text style={styles.lastTrickText}>ULTIMA</Text>
    </Pressable>
  );
}

// The previous trick laid out like the table: you at the bottom, your partner opposite, winner highlighted.
export function TrickReview({ trick, room, userId }: { trick: Trick; room: Room; userId: number }) {
  const mySeat = room.players.find((p) => p.userId === userId)?.seat ?? 0;
  const spots = [styles.spotLeft, styles.spotTop, styles.spotRight, styles.spotBottom];
  return (
    <View style={styles.review}>
      {trick.cards.map((card) => {
        const player = room.players.find((p) => p.userId === card.userId);
        const winner = card.userId === trick.winnerUserId;
        return (
          <View key={cardKey(card)} accessible accessibilityLabel={`${player?.username}: ${cardLabel(card)}${winner ? ', prende' : ''}`}
            style={[styles.spot, spots[(((player?.seat ?? 0) - mySeat + 4) % 4 + 3) % 4]]}>
            <View style={[styles.reviewCard, winner && styles.reviewWinner]}>
              <Image source={cardImage(card)} style={styles.trumpImage} />
            </View>
            {winner && <View style={styles.crown}><Text style={styles.crownText}>PRESA!</Text></View>}
            <View style={styles.reviewPlate}><Text numberOfLines={1} style={styles.plateText}>
              {card.userId === userId ? 'TU' : player?.username}{card.signal ? ` ${signalIcons[card.signal]}` : ''}</Text></View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  board: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  shield: { width: 50, paddingTop: 3, paddingBottom: 6, alignItems: 'center', borderWidth: 2, borderColor: outline,
    borderTopLeftRadius: 10, borderTopRightRadius: 10, borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    ...hard(colors.ink) },
  shieldLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  shieldPoints: { fontSize: 22, lineHeight: 24, fontWeight: '900', fontStyle: 'italic' },
  pips: { flexDirection: 'row', gap: 3 },
  pip: { width: 6, height: 6, borderRadius: 3, borderWidth: 1.5 },
  versus: { color: colors.text, fontSize: 11, fontWeight: '900', fontStyle: 'italic' },
  trump: { alignItems: 'center' },
  trumpCard: { width: 34, height: 54, borderRadius: 5, borderWidth: 2, borderColor: colors.primary, backgroundColor: '#fffef8',
    alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '8deg' }],
    ...hard(colors.purple) },
  trumpImage: { width: '100%', height: '100%', resizeMode: 'contain', borderRadius: 3 },
  trumpUnknown: { color: colors.purpleDeep, fontSize: 24, fontWeight: '900' },
  ribbon: { marginTop: -8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 2, borderColor: outline,
    backgroundColor: colors.purple, transform: [{ rotate: '-3deg' }] },
  ribbonText: { color: colors.text, fontSize: 10, fontWeight: '900', fontStyle: 'italic' },
  round: { marginTop: 3, color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  player: { alignItems: 'center' },
  pulse: { position: 'absolute', top: 0, width: 46, height: 46, borderRadius: 23, borderWidth: 3 },
  avatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 3, backgroundColor: colors.purpleDeep,
    alignItems: 'center', justifyContent: 'center', ...hard(colors.ink) },
  avatarActive: { transform: [{ scale: 1.1 }] },
  initial: { color: colors.text, fontSize: 20, fontWeight: '900', fontStyle: 'italic' },
  botTag: { position: 'absolute', bottom: -6, paddingHorizontal: 4, borderRadius: 4, backgroundColor: outline },
  botText: { color: colors.muted, fontSize: 7, fontWeight: '900' },
  plate: { marginTop: 6, maxWidth: 92, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 2,
    borderColor: outline, backgroundColor: colors.surface },
  plateText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  plateTextActive: { color: colors.ink, fontWeight: '900' },
  bubble: { position: 'absolute', top: -10, left: 34, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
    borderWidth: 2, borderColor: outline, backgroundColor: '#fff', transform: [{ rotate: '6deg' }] },
  bubbleText: { color: colors.ink, fontSize: 9, fontWeight: '900' },
  timer: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: colors.primary, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center' },
  timerUrgent: { borderColor: teamColors.them, backgroundColor: '#4a1838' },
  timerText: { color: colors.text, fontSize: 17, fontWeight: '900', fontStyle: 'italic' },
  lastTrick: { width: 64, height: 58, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 3, borderRadius: 7,
    borderWidth: 2, borderColor: outline, backgroundColor: colors.purple, borderBottomWidth: 7,
    ...hard(colors.ink) },
  lastTrickPressed: { transform: [{ translateX: 2 }, { translateY: 2 }], shadowOffset: { width: 1, height: 1 } },
  miniFan: { position: 'absolute', top: 5, left: 10, width: 46, height: 30 },
  miniCard: { position: 'absolute', width: 18, height: 28, borderRadius: 2, backgroundColor: '#fffef8', resizeMode: 'contain' },
  lastTrickText: { color: colors.text, fontSize: 9, fontWeight: '900', fontStyle: 'italic',
    textShadowColor: outline, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 0 },
  review: { width: 330, height: 252, alignSelf: 'center' },
  spot: { position: 'absolute', alignItems: 'center', width: 96 },
  spotTop: { top: 0, left: 117 }, spotBottom: { top: 132, left: 117 },
  spotLeft: { top: 66, left: 0 }, spotRight: { top: 66, left: 234 },
  reviewCard: { width: 56, height: 89, borderRadius: 6, borderWidth: 2, borderColor: outline, backgroundColor: '#fffef8',
    ...hard(colors.ink) },
  reviewWinner: { borderColor: colors.primary, borderWidth: 3, transform: [{ scale: 1.08 }],
    ...hard(colors.purple, 4) },
  crown: { position: 'absolute', top: -10, paddingHorizontal: 6, borderRadius: 6, borderWidth: 2, borderColor: outline,
    backgroundColor: colors.primary, transform: [{ rotate: '-6deg' }] },
  crownText: { color: colors.ink, fontSize: 10, fontWeight: '900', fontStyle: 'italic' },
  reviewPlate: { marginTop: 4, maxWidth: 96, paddingHorizontal: 6, borderRadius: 6, backgroundColor: colors.ink },
  toastLayer: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  toast: { maxWidth: '70%', paddingHorizontal: 22, paddingVertical: 8, borderRadius: 10, borderWidth: 3, borderColor: outline,
    backgroundColor: colors.purple, ...hard(colors.ink) },
  toastHot: { backgroundColor: colors.primary },
  toastSignal: { backgroundColor: teamColors.them },
  toastText: { color: colors.text, fontSize: 26, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5,
    textShadowColor: outline, textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 0 },
  toastTextHot: { color: colors.ink, textShadowColor: '#ffffff80' },
});
