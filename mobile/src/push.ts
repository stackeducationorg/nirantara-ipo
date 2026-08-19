import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './queries';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Asks for notification permission and hands the Expo push token to the API, which is what
 * lets the allotment watcher reach this phone while the app is closed.
 */
export async function registerForPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!Device.isDevice) {
    return { ok: false, reason: 'Push notifications need a physical device.' };
  }

  if (Platform.OS === 'android') {
    // Android requires a channel before any notification can be shown.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'IPO alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2f5bea',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') {
    return { ok: false, reason: 'Notification permission was declined.' };
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;

  try {
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await api.registerPush({ expoToken: token });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
