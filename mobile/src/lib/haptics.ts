import * as Haptics from 'expo-haptics';
import { AppState, Platform } from 'react-native';

export function touchFeedback(kind: 'selection' | 'play' | 'success' = 'selection') {
  if (AppState.currentState !== 'active') return;
  const action = Platform.OS === 'android'
    ? Haptics.performAndroidHapticsAsync(kind === 'selection' ? Haptics.AndroidHaptics.Segment_Tick : Haptics.AndroidHaptics.Confirm)
    : kind === 'selection' ? Haptics.selectionAsync()
      : kind === 'play' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  void action.catch((error: unknown) => console.warn('Haptic feedback unavailable', error));
}
