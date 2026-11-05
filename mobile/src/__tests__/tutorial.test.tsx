import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import TutorialScreen from '@/app/tutorial';
import { tableLayout } from '@/lib/tableLayout';

jest.mock('expo-router', () => ({ useRouter: () => ({ canGoBack: () => false, replace: jest.fn() }) }));

const renderTable = () => render(
  <SafeAreaProvider initialMetrics={{
    frame: { x: 0, y: 0, width: 844, height: 390 },
    insets: { top: 0, bottom: 21, left: 44, right: 44 },
  }}>
    <TutorialScreen />
  </SafeAreaProvider>,
);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
  jest.spyOn(Animated, 'sequence').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
});

afterEach(() => jest.restoreAllMocks());

it('requires selection and confirmation, allows changing cards, and resets after a winning play', async () => {
  await renderTable();
  await fireEvent(screen.getByTestId('table-stage'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 464, height: 283 } },
  });
  const firstCard = tableLayout(464, 283).cards[0];
  expect(screen.getByLabelText('1. Avversario: Asso di denara')).toHaveStyle({ left: firstCard.x, top: firstCard.y });

  expect(screen.getByRole('button', { name: 'Gioca' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Gioca' })).not.toBeBusy();

  await fireEvent.press(screen.getByRole('button', { name: 'Cavallo di bastoni' }));
  expect(screen.getByRole('button', { name: 'Cavallo di bastoni' })).toBeSelected();
  expect(screen.queryByText('Presa agli avversari.')).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Re di coppe' }));
  expect(screen.getByRole('button', { name: 'Cavallo di bastoni' })).not.toBeSelected();
  expect(screen.getByRole('button', { name: 'Re di coppe' })).toBeSelected();
  expect(screen.queryByText('Presa tua.')).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Gioca' }));
  expect(screen.getByText('Presa tua.')).toBeOnTheScreen();
  expect(screen.getByLabelText('4. Tu: Re di coppe, vince la presa', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Re di coppe' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cavallo di bastoni' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Cavallo di bastoni', includeHiddenElements: true })).toBeDisabled();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(expect.stringContaining('Presa tua.'));

  await fireEvent.press(screen.getByRole('button', { name: 'Riprova la presa' }));
  expect(screen.queryByText('Presa tua.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Re di coppe' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Cavallo di bastoni' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Gioca' })).toBeDisabled();
});

it('allows a legal losing card and explains why the due beats the asso', async () => {
  await renderTable();
  await fireEvent.press(screen.getByRole('button', { name: 'Cavallo di bastoni' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Gioca' }));

  expect(screen.getByText('Presa agli avversari.')).toBeOnTheScreen();
  expect(screen.getByText(/nel Beccaccino il due batte l’asso/)).toBeOnTheScreen();
  expect(screen.getByLabelText('3. Avversario: Due di denara, vince la presa', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByLabelText('4. Tu: Cavallo di bastoni', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(expect.stringContaining('Presa agli avversari.'));
});

it('disables selection animation for reduced motion and removes the preference listener', async () => {
  const remove = jest.fn();
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove });
  const app = await renderTable();
  await fireEvent.press(screen.getByRole('button', { name: 'Re di coppe' }));

  expect(Animated.timing).not.toHaveBeenCalled();
  await app.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

it('honors preference changes even when the initial preference query resolves later', async () => {
  let resolvePreference!: (value: boolean) => void;
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(new Promise((resolve) => { resolvePreference = resolve; }));
  const listener = jest.spyOn(AccessibilityInfo, 'addEventListener');
  await renderTable();
  const motionListener = listener.mock.calls.find(([event]) => event === 'reduceMotionChanged')?.[1];
  if (!motionListener) throw new Error('Reduced-motion listener missing');

  await act(() => motionListener(true));
  await act(() => resolvePreference(false));
  await fireEvent.press(screen.getByRole('button', { name: 'Re di coppe' }));
  expect(Animated.timing).not.toHaveBeenCalled();

  await act(() => motionListener(false));
  expect(Animated.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 140, useNativeDriver: true }));
  jest.mocked(Animated.timing).mockClear();
  await act(() => motionListener(true));
  await fireEvent.press(screen.getByRole('button', { name: 'Cavallo di bastoni' }));
  expect(Animated.timing).not.toHaveBeenCalled();
});

it('keeps motion off and reports a preference query failure', async () => {
  const error = new Error('Preference unavailable');
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockRejectedValue(error);
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await renderTable();
  await fireEvent.press(screen.getByRole('button', { name: 'Re di coppe' }));

  expect(warning).toHaveBeenCalledWith('Unable to read the reduced-motion preference.', error);
  expect(Animated.timing).not.toHaveBeenCalled();
});

it('waits for card flight and collection before showing the result, and stops on unmount', async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(false);
  const start = jest.fn();
  const stop = jest.fn();
  jest.mocked(Animated.sequence).mockReturnValue({ start, stop, reset: jest.fn() });
  const app = await renderTable();
  await fireEvent.press(screen.getByRole('button', { name: 'Re di coppe' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Gioca' }));

  expect(screen.queryByText('Presa tua.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Un attimo…' })).toBeDisabled();
  for (const duration of [420, 240, 450]) {
    expect(Animated.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration, useNativeDriver: true }));
  }
  const finish = start.mock.calls[0][0];
  await act(() => finish({ finished: true }));
  expect(screen.getByText('Presa tua.')).toBeOnTheScreen();

  await fireEvent(screen.getByTestId('trick-result'), 'requestClose');
  expect(screen.queryByText('Il re è di coppe, la briscola: batte tutte le altre carte di questa presa. La presa va alla tua squadra.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Riprova la presa' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Riprova la presa' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Re di coppe' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Gioca' }));
  await app.unmount();
  expect(stop).toHaveBeenCalled();
  await act(() => finish({ finished: true }));
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
});

it('switches an ongoing trick to zero-duration motion when reduced motion is enabled', async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(false);
  const listener = jest.spyOn(AccessibilityInfo, 'addEventListener');
  const stop = jest.fn();
  jest.mocked(Animated.sequence).mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() });
  await renderTable();
  await fireEvent.press(screen.getByRole('button', { name: 'Re di coppe' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Gioca' }));
  jest.mocked(Animated.timing).mockClear();
  const changePreference = listener.mock.calls.find(([event]) => event === 'reduceMotionChanged')?.[1];
  if (!changePreference) throw new Error('Reduced-motion listener missing');

  await act(() => changePreference(true));

  expect(stop).toHaveBeenCalled();
  expect(Animated.timing).toHaveBeenCalledTimes(3);
  for (const [, config] of jest.mocked(Animated.timing).mock.calls) expect(config.duration).toBe(0);
});

it('waits for the motion preference before revealing cards instead of skipping their entrance', async () => {
  let resolvePreference!: (value: boolean) => void;
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(new Promise((resolve) => { resolvePreference = resolve; }));
  await renderTable();
  expect(screen.getByLabelText('1. Avversario: Asso di denara')).toHaveStyle({ opacity: 0 });

  await act(() => resolvePreference(true));

  expect(screen.getByLabelText('1. Avversario: Asso di denara')).toHaveStyle({ opacity: 1 });
  expect(Animated.timing).not.toHaveBeenCalled();
});

it('plays the selected card when it is tapped again', async () => {
  await renderTable();
  await fireEvent.press(screen.getByRole('button', { name: 'Cavallo di bastoni' }));
  expect(screen.queryByText('Presa agli avversari.')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Cavallo di bastoni' }));
  expect(screen.getByText('Presa agli avversari.')).toBeOnTheScreen();
});
