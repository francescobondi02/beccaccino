import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { colors } from '@/constants/theme';
import { SessionProvider } from '@/context/SessionContext';
import { initSound } from '@/lib/sound';

export { ErrorBoundary } from 'expo-router';

// Rules and account open as sheets over the current screen, like in-game panels.
const sheet = { presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } } as const;

export default function RootLayout() {
  useEffect(() => { void initSound(); }, []);
  return (
    <SessionProvider>
      <ThemeProvider value={DarkTheme}>
        <StatusBar hidden />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="index" options={{ title: 'BECCA' }} />
          <Stack.Screen name="rules" options={{ title: 'Come si gioca', ...sheet }} />
          <Stack.Screen name="account" options={{ title: 'Il tuo account', ...sheet }} />
          <Stack.Screen name="tutorial" options={{ title: 'Prova una presa' }} />
          <Stack.Screen name="play" options={{ title: 'Gioca' }} />
          <Stack.Screen name="room/[code]" options={{ title: 'Stanza' }} />
          <Stack.Screen name="game/[code]" options={{ gestureEnabled: false }} />
        </Stack>
      </ThemeProvider>
    </SessionProvider>
  );
}
