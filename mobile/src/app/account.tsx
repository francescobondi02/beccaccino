import { useRouter } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/ActionButton';
import { colors } from '@/constants/theme';
import { useSession } from '@/context/SessionContext';

export default function AccountScreen() {
  const { state, login, logout, retry } = useSession();
  const router = useRouter();
  const { width, height, fontScale } = useWindowDimensions();
  const stacked = width < height || width < 560 || fontScale >= 1.4;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null);
  const exit = () => router.canGoBack() ? router.back() : router.replace('/');
  const submit = () => {
    if (state.status !== 'signedOut' || !username.trim() || !password) return;
    Keyboard.dismiss();
    const secret = password;
    setPassword('');
    void login(username, secret);
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={styles.panel}>
            {state.status === 'loading' ? (
              <View accessible accessibilityRole="progressbar" accessibilityLabel="Verifica dell’account in corso" accessibilityState={{ busy: true }} style={styles.loading}>
                <ActivityIndicator accessible={false} color={colors.primary} />
                <Text style={styles.description}>Un attimo, verifichiamo il tuo account.</Text>
              </View>
            ) : <>
              <Text style={styles.eyebrow}>IL TUO ACCOUNT BECCA</Text>
              <Text accessibilityRole="header" style={styles.heading}>
                {state.status === 'signedIn' ? `Sei dentro, ${state.user.username}.`
                  : state.status === 'error' ? 'Ritroviamo il collegamento.' : 'Il tuo socio ti aspetta.'}
              </Text>
              {state.message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{state.message}</Text>}
              {state.status === 'signedOut' && <>
                <View style={[styles.fields, stacked && styles.stacked]}>
                  <View style={[styles.field, stacked && styles.stackedField]}>
                    <Text style={styles.label}>Nome utente</Text>
                    <TextInput accessibilityLabel="Nome utente" value={username} onChangeText={setUsername}
                      autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username"
                      returnKeyType="next" onSubmitEditing={() => passwordInput.current?.focus()}
                      selectionColor={colors.primary} style={styles.input} />
                  </View>
                  <View style={[styles.field, stacked && styles.stackedField]}>
                    <Text style={styles.label}>Password</Text>
                    <View style={styles.passwordRow}>
                      <TextInput ref={passwordInput} accessibilityLabel="Password" value={password} onChangeText={setPassword}
                        autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password"
                        secureTextEntry={!showPassword} returnKeyType="go" onSubmitEditing={submit}
                        selectionColor={colors.primary} style={[styles.input, styles.passwordInput]} />
                      <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Nascondi password' : 'Mostra password'}
                        onPress={() => setShowPassword((value) => !value)} style={styles.visibility}>
                        <Text style={styles.visibilityLabel}>{showPassword ? 'Nascondi' : 'Mostra'}</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
                <ActionButton label="Accedi" disabled={!username.trim() || !password} onPress={submit} />
                {__DEV__ && <Text style={styles.description}>In locale usa un account di prova. I dati del servizio pubblico sono separati.</Text>}
              </>}
              {state.status === 'signedIn' && <>
                <Text style={styles.description}>Accesso verificato dal server. Il tavolo online non è ancora collegato.</Text>
                <ActionButton label="Torna alla home" onPress={exit} />
                <ActionButton secondary label="Esci dall’account" onPress={() => { void logout(); }} />
              </>}
              {state.status === 'error' && <>
                <ActionButton label="Riprova il collegamento" onPress={retry} />
                <ActionButton secondary label="Rimuovi la sessione salvata" onPress={() => { void logout(); }} />
              </>}
              {state.status !== 'signedIn' && <ActionButton secondary label="Torna alla home" onPress={exit} />}
            </>}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  panel: {
    maxWidth: 760, width: '100%', alignSelf: 'center', gap: 12, padding: 20,
    borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  heading: { color: colors.text, fontSize: 28, fontWeight: '900' },
  description: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 16, lineHeight: 22 },
  fields: { flexDirection: 'row', gap: 16 },
  stacked: { flexDirection: 'column' },
  field: { flex: 1, gap: 6 },
  stackedField: { flex: 0 },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  input: {
    minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 10, color: colors.text, backgroundColor: colors.background, fontSize: 17,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  passwordInput: { flex: 1 },
  visibility: { minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: 4 },
  visibilityLabel: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  loading: { alignItems: 'center', gap: 16, paddingVertical: 24 },
});
