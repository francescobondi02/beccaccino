import { act, fireEvent } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { AccessibilityInfo, Animated, AppState, Dimensions, StyleSheet } from 'react-native';

import RootLayout from '@/app/_layout';
import AccountScreen from '@/app/account';
import HomeScreen from '@/app/index';
import RulesScreen from '@/app/rules';
import TutorialScreen from '@/app/tutorial';
import PlayScreen from '@/app/play';
import RoomScreen from '@/app/room/[code]';
import GameScreen from '@/app/game/[code]';

const routes = { _layout: RootLayout, index: HomeScreen, rules: RulesScreen, tutorial: TutorialScreen, account: AccountScreen,
  play: PlayScreen, 'room/[code]': RoomScreen, 'game/[code]': GameScreen };
const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const originalBackendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
const originalAppState = AppState.currentState;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.EXPO_PUBLIC_BACKEND_URL;
  AppState.currentState = 'active';
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});

afterEach(async () => {
  AppState.currentState = originalAppState;
  await act(() => Dimensions.set({ window: originalWindow, screen: originalScreen }));
  if (originalBackendUrl === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = originalBackendUrl;
  jest.restoreAllMocks();
});

it.each([
  { width: 568, height: 320, fontScale: 1 },
  { width: 844, height: 390, fontScale: 2 },
  { width: 390, height: 844, fontScale: 1 },
])('keeps the first-use flow available at $width×$height with font scale $fontScale', async (size) => {
  Dimensions.set({ window: { ...size, scale: 3 }, screen: { ...size, scale: 3 } });
  const app = await renderRouter(routes);
  expect(screen.getByTestId('home-card-artwork', { includeHiddenElements: true })).toHaveStyle({
    width: '100%', height: Math.min(220, size.height * 0.52),
  });
  const artworkHeight = Math.min(220, size.height * 0.52);
  const artworkWidth = size.width < size.height || size.fontScale >= 1.4 ? 300 : 180;
  await fireEvent(screen.getByTestId('home-card-artwork', { includeHiddenElements: true }), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: artworkWidth, height: artworkHeight } },
  });
  const cards = screen.getAllByTestId('home-card', { includeHiddenElements: true });
  expect(cards).toHaveLength(5);
  for (const card of cards) {
    const { left, top, width, height, transform } = StyleSheet.flatten(card.props.style);
    const angle = Number.parseFloat(transform[1].rotate) * Math.PI / 180;
    const halfWidth = (width * Math.abs(Math.cos(angle)) + height * Math.abs(Math.sin(angle))) / 2;
    const halfHeight = (height * Math.abs(Math.cos(angle)) + width * Math.abs(Math.sin(angle))) / 2;
    expect(left + width / 2 - halfWidth).toBeGreaterThanOrEqual(0);
    expect(left + width / 2 + halfWidth).toBeLessThanOrEqual(artworkWidth);
    expect(top + height / 2 - halfHeight).toBeGreaterThanOrEqual(0);
    expect(top + height / 2 + halfHeight).toBeLessThanOrEqual(artworkHeight);
  }

  await fireEvent.press(screen.getByRole('button', { name: 'Prova' }));
  expect(app.getPathname()).toBe('/tutorial');
  await fireEvent.press(screen.getByRole('button', { name: 'Re di coppe' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Gioca' }));
  expect(screen.getByText('Presa tua.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Esci dalla prova' }));
  expect(app.getPathname()).toBe('/');

  await fireEvent.press(screen.getByRole('button', { name: 'Regole' }));
  expect(app.getPathname()).toBe('/rules');
  expect(screen.getByText('Il socio è di fronte a te.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Regola precedente' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Regola successiva' }));
  expect(screen.getByText('Una briscola cambia tutto.')).toBeOnTheScreen();
  expect(screen.queryByText('Il socio è di fronte a te.')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Chiudi' }));
  expect(app.getPathname()).toBe('/');

  await fireEvent.press(screen.getByRole('button', { name: 'Regole' }));
  for (let page = 1; page < 5; page++) await fireEvent.press(screen.getByRole('button', { name: 'Regola successiva' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Prova una presa' }));
  expect(app.getPathname()).toBe('/tutorial');
  await fireEvent.press(screen.getByRole('button', { name: 'Esci' }));
  expect(app.getPathname()).toBe('/');

  await fireEvent.press(screen.getByRole('button', { name: 'Accedi' }));
  expect(app.getPathname()).toBe('/account');
  await fireEvent.press(screen.getByRole('button', { name: 'Chiudi' }));
  expect(app.getPathname()).toBe('/');
});

it('returns home when the rules were opened directly without navigation history', async () => {
  const app = await renderRouter(routes, { initialUrl: '/rules' });

  await fireEvent.press(screen.getByRole('button', { name: 'Chiudi' }));

  expect(app.getPathname()).toBe('/');
  expect(screen.getByRole('button', { name: 'Regole' })).toBeOnTheScreen();
});

it('returns home when the tutorial was opened directly without navigation history', async () => {
  const app = await renderRouter(routes, { initialUrl: '/tutorial' });

  await fireEvent.press(screen.getByRole('button', { name: 'Esci' }));

  expect(app.getPathname()).toBe('/');
  expect(screen.getByRole('button', { name: 'Prova' })).toBeOnTheScreen();
});

it('pauses home motion in the background and on navigation, and restores it on return', async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(false);
  const loop = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
  const spring = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
  jest.spyOn(Animated, 'loop').mockReturnValue(loop);
  jest.spyOn(Animated, 'spring').mockReturnValue(spring);
  const listener = jest.spyOn(AppState, 'addEventListener');
  await renderRouter(routes);
  const changeState = listener.mock.calls.find(([event]) => event === 'change')?.[1];
  if (!changeState) throw new Error('App-state listener missing');

  await act(() => changeState('background'));
  loop.start.mockClear();
  loop.stop.mockClear();
  await act(() => changeState('active'));
  expect(loop.start).toHaveBeenCalledTimes(1);
  await fireEvent(screen.getByTestId('home-card-touch', { includeHiddenElements: true }), 'pressIn');
  expect(Animated.spring).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
    toValue: 1, useNativeDriver: true,
  }));
  await fireEvent(screen.getByTestId('home-card-touch', { includeHiddenElements: true }), 'pressOut');
  expect(Animated.spring).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
    toValue: 0, useNativeDriver: true,
  }));

  await act(() => changeState('inactive'));
  expect(loop.stop).toHaveBeenCalledTimes(1);
  await act(() => changeState('active'));
  expect(loop.start).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByRole('button', { name: 'Regole' }));
  expect(loop.stop).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByRole('button', { name: 'Chiudi' }));
  expect(loop.start).toHaveBeenCalledTimes(3);
});

it('keeps the home still until the motion preference is known and reacts to preference changes', async () => {
  let resolvePreference!: (value: boolean) => void;
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(new Promise((resolve) => { resolvePreference = resolve; }));
  const loop = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
  jest.spyOn(Animated, 'loop').mockReturnValue(loop);
  const spring = jest.spyOn(Animated, 'spring');
  const listener = jest.spyOn(AccessibilityInfo, 'addEventListener');
  await renderRouter(routes);
  expect(Animated.loop).not.toHaveBeenCalled();
  await fireEvent(screen.getByTestId('home-card-touch', { includeHiddenElements: true }), 'pressIn');
  expect(spring).not.toHaveBeenCalled();

  await act(() => resolvePreference(false));
  expect(loop.start).toHaveBeenCalledTimes(1);
  const changePreference = listener.mock.calls.find(([event]) => event === 'reduceMotionChanged')?.[1];
  if (!changePreference) throw new Error('Reduced-motion listener missing');
  await act(() => changePreference(true));
  expect(loop.stop).toHaveBeenCalledTimes(1);
  await fireEvent(screen.getByTestId('home-card-touch', { includeHiddenElements: true }), 'pressIn');
  expect(spring).not.toHaveBeenCalled();
});
