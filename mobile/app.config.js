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
    // Account that owns the EAS project referenced by extra.eas.projectId below.
    owner: 'rahulrgadgimata',
    // Release version. Bump this and android.versionCode for every APK you hand out.
    //
    // It must only ever go UP: the update gate compares it numerically against the API's
    // minimum, and builds already in the wild report 1.0.0. A 0.0.0.x scheme would compare
    // as *older* than those, so no existing install would ever be prompted to update.
    // Three numeric parts also keeps it valid for iOS.
    version: '1.0.1',
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
      // Firebase config for the FCM sender. Android push cannot work without this, but this
      // file alone is not enough — the matching FCM V1 service account key must also be
      // uploaded to EAS (npx eas credentials) so Expo's servers are allowed to send.
      googleServicesFile: './google-services.json',
      // Must be an integer and must increase for every Play Store upload.
      versionCode: 4,
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
        // Must be a real id, not undefined: push.ts reads it to call getExpoPushTokenAsync,
        // which throws without one — that is why no device ever registered for notifications.
        // Not a secret; Expo expects it committed.
        projectId: process.env.EAS_PROJECT_ID || 'd318874f-0db8-40ff-a7ef-6a4965d304ee',
      },
    },
  },
};
