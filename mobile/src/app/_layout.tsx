import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/constants/theme';
import { SessionProvider } from '@/context/SessionContext';

export { ErrorBoundary } from 'expo-router';

export default function RootLayout() {
  return (
    <SessionProvider>
      <ThemeProvider value={DarkTheme}>
        <StatusBar hidden />
        <Stack screenOptions={{
          headerTintColor: colors.primary,
          headerStyle: { backgroundColor: colors.background },
          contentStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerBackTitle: 'Indietro',
        }}>
          <Stack.Screen name="index" options={{ title: 'BECCA', headerShown: false }} />
          <Stack.Screen name="rules" options={{ title: 'Come si gioca' }} />
          <Stack.Screen name="tutorial" options={{ title: 'Prova una presa', headerShown: false }} />
          <Stack.Screen name="connection" options={{ title: 'Connessione' }} />
          <Stack.Screen name="account" options={{ title: 'Il tuo account' }} />
        </Stack>
      </ThemeProvider>
    </SessionProvider>
  );
}
