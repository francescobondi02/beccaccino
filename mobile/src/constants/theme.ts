import { Platform, StyleSheet } from 'react-native';

// Mirrors the website's arcade palette (frontend/src/styles/arcade.css).
export const colors = {
  background: '#101014',
  surface: '#19151f',
  text: '#f8f5ff',
  muted: '#b8b4c8',
  primary: '#d9ff43',
  purple: '#9560ff',
  purpleDeep: '#3b2370',
  pink: '#ff73bf',
  ink: '#141416',
  line: '#34323e',
  danger: '#ffb4b4',
} as const;

export const fonts = {
  display: { fontWeight: '900', fontStyle: 'italic', letterSpacing: -1 },
  label: { fontFamily: Platform.select({ ios: 'AvenirNext-Heavy' }), fontWeight: '800' },
  body: { fontFamily: Platform.select({ ios: 'Avenir Next' }) },
} as const;

// Flat offset shadow for small or rotated shapes (iOS draws it from the view outline; Android shows none).
export const hard = (color: string, depth = 3) =>
  ({ shadowColor: color, shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: depth, height: depth } }) as const;

// Screen, layout and text styles shared by the menu screens.
export const shared = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  layout: { flexDirection: 'row', gap: 24, paddingHorizontal: 24, paddingVertical: 14, maxWidth: 960, width: '100%', alignSelf: 'center' },
  eyebrow: { color: colors.pink, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  body: { ...fonts.body, color: colors.muted, fontSize: 14, lineHeight: 20 },
  note: { ...fonts.body, color: colors.muted, fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
