import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { checkBackendReadiness } from '@/lib/backend';
import ActionButton from '@/components/ActionButton';

type ConnectionState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

export default function ConnectionScreen() {
  const [attempt, setAttempt] = useState(0);
  const [requestState, setState] = useState<ConnectionState>({ status: 'loading' });
  const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  const state: ConnectionState | { status: 'unconfigured' } = backendUrl?.trim()
    ? requestState : { status: 'unconfigured' };

  useEffect(() => {
    let active = true;
    if (!backendUrl?.trim()) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    checkBackendReadiness(backendUrl, controller.signal)
      .then(() => {
        if (active) setState({ status: 'ready' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          message: controller.signal.aborted
            ? 'Il server non ha risposto entro 8 secondi.'
            : error instanceof TypeError ? 'Non riesco a raggiungere il server. Controlla la connessione e riprova.'
              : error instanceof Error ? error.message : 'Impossibile contattare il backend.',
        });
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt, backendUrl]);

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.eyebrow}>IL TUO COLLEGAMENTO AL TAVOLO</Text>
          <View style={styles.indicator} accessible={false} importantForAccessibility="no-hide-descendants">
            {state.status === 'loading'
              ? <ActivityIndicator color={colors.primary} />
              : <Text style={[styles.symbol, state.status === 'error' && styles.error]}>
                {state.status === 'ready' ? 'OK' : state.status === 'error' ? '!' : '—'}
              </Text>}
          </View>
          <Text accessibilityRole="header" style={styles.heading}>
            {state.status === 'ready' ? 'Ci siamo.'
              : state.status === 'error' ? 'Riproviamo?'
                : state.status === 'unconfigured' ? 'Manca ancora un collegamento.'
                  : 'Un attimo, ci colleghiamo.'}
          </Text>
          <Text accessibilityRole={state.status === 'error' ? 'alert' : 'text'} accessibilityLiveRegion="polite" style={styles.status}>
            {state.status === 'loading' ? 'Connessione in corso…'
              : state.status === 'ready' ? 'Backend pronto.'
                : state.status === 'unconfigured' ? 'Il server non è ancora configurato per questa versione dell’app.'
                  : state.message}
          </Text>
          {state.status !== 'unconfigured' && (
            <ActionButton
              label={state.status === 'loading' ? 'Verifica in corso' : 'Riprova'}
              disabled={state.status === 'loading'}
              onPress={() => {
                setState({ status: 'loading' });
                setAttempt((value) => value + 1);
              }}
            />
          )}
          <Text style={styles.description}>Questo controllo non esegue l’accesso e non crea account o partite.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  panel: {
    maxWidth: 560, width: '100%', alignSelf: 'center', gap: 18, padding: 24,
    borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  indicator: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  symbol: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  error: { color: colors.danger },
  heading: { color: colors.text, fontSize: 28, fontWeight: '800' },
  description: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  status: { color: colors.text, fontSize: 17, lineHeight: 26 },
});
