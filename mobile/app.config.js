/**
 * Replaces app.json so the API base can come from the environment at build time.
 *
 * A device running the installed APK cannot reach `localhost` — that is the phone itself — so a
 * real build must be given the machine or server that actually hosts the API:
 *   EXPO_PUBLIC_API_BASE=https://api.yourdomain.com/api
 * In Expo Go this can stay unset; the app falls back to the host that served the bundle.
 */
// Defaults to the deployed API so a build never silently ships pointing at a developer's
// machine. Override with EXPO_PUBLIC_API_BASE when testing against a local server.
const apiBase = process.env.EXPO_PUBLIC_API_BASE || 'https://api.nirantara.cloud/api';

// Android blocks plain HTTP by default. Allow it only when the API is not HTTPS, which is the
// case while testing against a machine on your LAN.
const usesCleartextTraffic = apiBase.startsWith('http://');

export default {
  expo: {
    name: 'Nirantara IPO',
    slug: 'niranthar-ipo',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'niranthar',
    userInterfaceStyle: 'automatic',
    icon: './assets/icon.png',
    splash: {
      image: './assets/icon.png',
      resizeMode: 'contain',
      backgroundColor: '#0a0a0b',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.niranthar.ipo',
    },
    android: {
      package: 'com.niranthar.ipo',
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: './assets/icon.png',
        backgroundColor: '#ffffff',
      },
      permissions: ['POST_NOTIFICATIONS', 'INTERNET'],
      usesCleartextTraffic,
    },
    plugins: [['expo-notifications', { color: '#e0483d' }]],
    extra: {
      apiBase,
      eas: {
        // `eas init` writes the real project id here.
        projectId: process.env.EAS_PROJECT_ID || undefined,
      },
    },
  },
};
