import Constants from 'expo-constants';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme';

// Closes the in-app browser tab once Google redirects back, instead of leaving it open
// behind the app. Safe to call at module scope; it only registers a handler.
WebBrowser.maybeCompleteAuthSession();

/**
 * Google sign-in for the app.
 *
 * Both client ids are passed. androidClientId is what Google requires to accept the request
 * from this package and signing certificate; webClientId is what makes Google mint an
 * **ID token** rather than only an access token — the server verifies that token, so without
 * it there is nothing to send.
 */
export function GoogleButton({
  onIdToken,
  busy,
}: {
  onIdToken: (idToken: string) => void;
  busy?: boolean;
}) {
  const t = useTheme();
  const extra = Constants.expoConfig?.extra as
    | { googleWebClientId?: string; googleAndroidClientId?: string }
    | undefined;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: extra?.googleWebClientId,
    androidClientId: extra?.googleAndroidClientId,
  });

  useEffect(() => {
    if (response?.type !== 'success') return;
    const token = response.params?.id_token ?? response.authentication?.idToken;
    if (token) onIdToken(token);
    // onIdToken is recreated each render by callers; depending on it would re-fire the
    // effect and sign the user in twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  // Nothing to show if the build was made without the ids — better than a button that
  // fails the moment it is pressed.
  if (!extra?.googleWebClientId) return null;

  const disabled = !request || busy;

  return (
    <View style={{ marginBottom: 16 }}>
      <Pressable
        onPress={() => void promptAsync()}
        disabled={disabled}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          paddingVertical: 13,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.surface,
          opacity: disabled ? 0.55 : 1,
        }}
      >
        {busy ? (
          <ActivityIndicator color={t.textDim} size="small" />
        ) : (
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#4285F4' }}>G</Text>
        )}
        <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>Continue with Google</Text>
      </Pressable>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
        <Text style={{ color: t.textFaint, fontSize: 12 }}>or</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
      </View>
    </View>
  );
}
