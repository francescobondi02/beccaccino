import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export default function useReducedMotion() {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let useInitialValue = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      useInitialValue = false;
      setReduceMotion(value);
    });
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { if (useInitialValue) setReduceMotion(value); })
      .catch((error: unknown) => {
        console.warn('Unable to read the reduced-motion preference.', error);
        if (useInitialValue) setReduceMotion(true);
      });
    return () => {
      useInitialValue = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
