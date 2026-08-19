import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { Banner, Button, Card } from '../components';
import { useTheme } from '../theme';

type Mode = 'signin' | 'signup' | 'pair';

export function SignInScreen() {
  const t = useTheme();
  const { login, register, pair } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [syncKey, setSyncKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') await login(email.trim(), password);
      else if (mode === 'signup') await register(email.trim(), password, name.trim() || undefined);
      else await pair(syncKey.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const input = {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.bg,
    color: t.text,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  };

  const label = { color: t.textDim, fontSize: 12.5, fontWeight: '500' as const, marginBottom: 6 };

  const heading =
    mode === 'signin'
      ? { title: 'Sign in', sub: 'Track allotments across all your accounts.' }
      : mode === 'signup'
        ? { title: 'Create your account', sub: 'Free. Takes about ten seconds.' }
        : { title: 'Link this device', sub: 'Enter the sync key from the website.' };

  const canSubmit =
    mode === 'pair' ? syncKey.trim().length >= 8 : email.includes('@') && password.length >= 8;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 22 }}>
        <View style={{ alignItems: 'center', marginBottom: 26 }}>
          <Image
            source={require('../../assets/icon.png')}
            style={{ width: 52, height: 52, borderRadius: 13, marginBottom: 14 }}
          />
          <Text style={{ color: t.text, fontSize: 21, fontWeight: '600', letterSpacing: -0.4 }}>
            {heading.title}
          </Text>
          <Text style={{ color: t.textDim, fontSize: 13.5, marginTop: 4 }}>{heading.sub}</Text>
        </View>

        <Card style={{ padding: 18 }}>
          {error && <Banner tone="error">{error}</Banner>}

          {mode === 'pair' ? (
            <View style={{ marginBottom: 14 }}>
              <Text style={label}>Sync key</Text>
              <TextInput
                style={input}
                placeholder="NRTH-XXXX-XXXX-XXXX"
                placeholderTextColor={t.textFaint}
                autoCapitalize="characters"
                autoCorrect={false}
                value={syncKey}
                onChangeText={(v) => setSyncKey(v.toUpperCase())}
              />
            </View>
          ) : (
            <>
              {mode === 'signup' && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={label}>Name (optional)</Text>
                  <TextInput style={input} value={name} onChangeText={setName} placeholderTextColor={t.textFaint} />
                </View>
              )}
              <View style={{ marginBottom: 14 }}>
                <Text style={label}>Email</Text>
                <TextInput
                  style={input}
                  placeholder="you@example.com"
                  placeholderTextColor={t.textFaint}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                  value={email}
                  onChangeText={setEmail}
                />
              </View>
              <View style={{ marginBottom: 14 }}>
                <Text style={label}>Password</Text>
                <TextInput
                  style={input}
                  secureTextEntry
                  autoCapitalize="none"
                  textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                  value={password}
                  onChangeText={setPassword}
                  placeholderTextColor={t.textFaint}
                />
                {mode === 'signup' && (
                  <Text style={{ color: t.textFaint, fontSize: 12, marginTop: 6 }}>At least 8 characters.</Text>
                )}
              </View>
            </>
          )}

          <Button
            title={mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Link device'}
            onPress={submit}
            disabled={!canSubmit}
            loading={busy}
          />
        </Card>

        <View style={{ alignItems: 'center', marginTop: 20, gap: 8 }}>
          {mode === 'signin' && (
            <>
              <Pressable onPress={() => setMode('signup')}>
                <Text style={{ color: t.textDim, fontSize: 13 }}>
                  New here? <Text style={{ color: t.accent, fontWeight: '600' }}>Create an account</Text>
                </Text>
              </Pressable>
              <Pressable onPress={() => setMode('pair')}>
                <Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>Use a sync key instead</Text>
              </Pressable>
            </>
          )}
          {mode !== 'signin' && (
            <Pressable onPress={() => setMode('signin')}>
              <Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>Back to sign in</Text>
            </Pressable>
          )}
        </View>

        <Text style={{ color: t.textFaint, fontSize: 11.5, textAlign: 'center', marginTop: 30 }}>
          All rights reserved to Nirantara IPO © {new Date().getFullYear()}.{'\n'}
          Developed by stackeducation.in
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
