import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder } from 'react-native';
import { touchFeedback } from '@/lib/haptics';

const dropDistance = 70;

// Drag a hand card upwards onto the table to play it. Taps and long presses still reach the card's Pressable:
// the gesture is only claimed once the finger actually moves. `onDrop` resolves false to send the card back.
export default function useCardDrag(enabled: boolean, onDrop: () => Promise<boolean>, onDrag?: (active: boolean) => void) {
  const [offset] = useState(() => new Animated.ValueXY());
  const latest = useRef({ enabled, onDrop, onDrag });
  useEffect(() => { latest.current = { enabled, onDrop, onDrag }; });
  // One PanResponder must survive re-renders mid-drag; `latest` is read only inside its gesture callbacks.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    const back = () => Animated.spring(offset, { toValue: { x: 0, y: 0 }, damping: 14, stiffness: 220, useNativeDriver: false }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, { dx, dy }) => latest.current.enabled && Math.hypot(dx, dy) > 8,
      onPanResponderGrant: () => { touchFeedback(); latest.current.onDrag?.(true); },
      onPanResponderMove: Animated.event([null, { dx: offset.x, dy: offset.y }], { useNativeDriver: false }),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_, { dy }) => {
        latest.current.onDrag?.(false);
        if (dy > -dropDistance) { back(); return; }
        void latest.current.onDrop().then((played) => { if (!played) back(); });
      },
      onPanResponderTerminate: () => { latest.current.onDrag?.(false); back(); },
    });
  });
  return { handlers: responder.panHandlers, offset };
}
