import { Platform } from 'react-native';

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
  border: '#766780',
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
