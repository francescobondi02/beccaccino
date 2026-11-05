import { useRouter } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Keyboard, Linking, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import ActionButton from '@/components/ActionButton';
import Sheet from '@/components/Sheet';
import { colors, fonts } from '@/constants/theme';
import { useSession } from '@/context/SessionContext';
import useCloseOrHome from '@/hooks/useCloseOrHome';

const siteUrl = 'https://beccaccino-client.vercel.app';

export default function AccountScreen() {
  const { state, login, logout, retry } = useSession();
  const router = useRouter();
  const { width, height, fontScale } = useWindowDimensions();
  const stacked = width < height || width < 560 || fontScale >= 1.4;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<'user' | 'password' | null>(null);
  const close = useCloseOrHome();
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null);
  const submit = () => {
    if (state.status !== 'signedOut' || !username.trim() || !password) return;
    Keyboard.dismiss();
    const secret = password;
    setPassword('');
    void login(username, secret);
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Sheet onClose={close} width={640} title={state.status === 'loading' ? 'Il tuo account'
        : state.status === 'signedIn' ? `Sei dentro, ${state.user.username}.`
          : state.status === 'error' ? 'Ritroviamo il collegamento.' : 'Il tuo socio ti aspetta.'}>
            {state.status === 'loading' ? (
              <View accessible accessibilityRole="progressbar" accessibilityLabel="Verifica dell’account in corso" accessibilityState={{ busy: true }} style={styles.loading}>
                <ActivityIndicator accessible={false} color={colors.primary} />
                <Text style={styles.description}>Un attimo, verifichiamo il tuo account.</Text>
              </View>
            ) : <>
              {state.message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{state.message}</Text>}
              {state.status === 'signedOut' && <>
                <View style={[styles.fields, stacked && styles.stacked]}>
                  <View style={[styles.field, stacked && styles.stackedField]}>
                    <Text style={styles.label}>NOME UTENTE</Text>
                    <TextInput accessibilityLabel="Nome utente" value={username} onChangeText={setUsername}
                      autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username"
                      returnKeyType="next" onSubmitEditing={() => passwordInput.current?.focus()}
                      onFocus={() => setFocused('user')} onBlur={() => setFocused(null)}
                      selectionColor={colors.primary} style={[styles.input, focused === 'user' && styles.inputFocused]} />
                  </View>
                  <View style={[styles.field, stacked && styles.stackedField]}>
                    <Text style={styles.label}>PASSWORD</Text>
                    <View style={styles.passwordRow}>
                      <TextInput ref={passwordInput} accessibilityLabel="Password" value={password} onChangeText={setPassword}
                        autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password"
                        secureTextEntry={!showPassword} returnKeyType="go" onSubmitEditing={submit}
                        onFocus={() => setFocused('password')} onBlur={() => setFocused(null)}
                        selectionColor={colors.primary} style={[styles.input, styles.passwordInput, focused === 'password' && styles.inputFocused]} />
                      <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Nascondi password' : 'Mostra password'}
                        onPress={() => setShowPassword((value) => !value)} style={styles.visibility}>
                        <Text style={styles.visibilityLabel}>{showPassword ? 'Nascondi' : 'Mostra'}</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
                <ActionButton label="Accedi" disabled={!username.trim() || !password} onPress={submit} />
                <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(siteUrl)} style={styles.link}>
                  <Text style={styles.description}>Non hai un account? <Text style={styles.linkText}>Registrati sul sito</Text></Text>
                </Pressable>
              </>}
              {state.status === 'signedIn' && <>
                <Text style={styles.description}>Tutto pronto. Il tavolo ti aspetta: tre bot allenati e una presa da vincere.</Text>
                <View style={styles.row}>
                  <View style={styles.grow}><ActionButton bolt label="Gioca" onPress={() => router.replace('/play')} /></View>
                  <ActionButton secondary label="Esci dall’account" onPress={() => { void logout(); }} />
                </View>
              </>}
              {state.status === 'error' && <>
                <ActionButton label="Riprova il collegamento" onPress={retry} />
                <ActionButton secondary label="Rimuovi la sessione salvata" onPress={() => { void logout(); }} />
              </>}
            </>}
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  description: { ...fonts.body, color: colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 15, lineHeight: 21 },
  fields: { flexDirection: 'row', gap: 14 },
  stacked: { flexDirection: 'column' },
  field: { flex: 1, gap: 6 },
  stackedField: { flex: 0 },
  label: { color: colors.text, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  input: {
    minHeight: 48, borderRadius: 7, borderWidth: 2, borderColor: colors.line,
    paddingHorizontal: 14, paddingVertical: 10, color: colors.text, backgroundColor: colors.background, fontSize: 17,
  },
  inputFocused: { borderColor: colors.primary },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  passwordInput: { flex: 1 },
  visibility: { minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: 4 },
  visibilityLabel: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: colors.primary, fontWeight: '800', textDecorationLine: 'underline' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  grow: { flex: 1 },
  loading: { alignItems: 'center', gap: 16, paddingVertical: 24 },
});
