import Constants from 'expo-constants';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { API_BASE } from './api';
import { useTheme } from './theme';

/**
 * Blocks the app when it is older than the minimum version the API still supports.
 *
 * This exists so a breaking API change cannot leave old installs silently failing in
 * confusing ways. It fails *open*: if the check cannot be reached the app runs as normal,
 * because a network blip must never brick someone's app.
 */

interface VersionInfo {
  minVersion: string;
  latestVersion: string;
  downloadUrl: string;
  message?: string;
}

/** Compares dotted numeric versions. Returns <0, 0 or >0 like a sort comparator. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function UpdateGate({ children }: { children: ReactNode }) {
  const t = useTheme();
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [checked, setChecked] = useState(false);

  const current = Constants.expoConfig?.version ?? '0.0.0';

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE}/app/version`, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: VersionInfo | null) => {
        if (!cancelled && data) setInfo(data);
      })
      .catch(() => {
        // Offline, or the API is down. Neither is a reason to lock the user out.
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!checked) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  const mustUpdate = info ? compareVersions(current, info.minVersion) < 0 : false;
  if (!mustUpdate || !info) return <>{children}</>;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
      }}
    >
      <Text style={{ color: t.text, fontSize: 20, fontWeight: '600', marginBottom: 10, textAlign: 'center' }}>
        Update required
      </Text>
      <Text style={{ color: t.textDim, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 22 }}>
        {info.message?.trim()
          ? info.message
          : `This version of Nirantara IPO is no longer supported. Install version ${info.latestVersion} to carry on.`}
      </Text>
      <Text style={{ color: t.textFaint, fontSize: 12, marginBottom: 22 }}>
        You have {current} · minimum {info.minVersion}
      </Text>

      <Pressable
        onPress={() => {
          void Linking.openURL(info.downloadUrl);
        }}
        style={{
          backgroundColor: t.accent,
          paddingVertical: 13,
          paddingHorizontal: 30,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Download the update</Text>
      </Pressable>
    </View>
  );
}
