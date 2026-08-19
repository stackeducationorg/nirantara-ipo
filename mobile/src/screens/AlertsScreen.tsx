import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { Banner, Button, Card, Empty, SectionTitle, makeStyles } from '../components';
import { relativeTime } from '../format';
import { registerForPush } from '../push';
import { IconBell, IconCalendar, IconClock, IconTarget, IconTrend } from '../icons';
import { useAppNavigation } from '../navigation';
import { api } from '../queries';
import { useTheme } from '../theme';
import type { AlertPrefs } from '../types';

const KIND_ICON: Record<string, (p: { size?: number; color: string }) => JSX.Element> = {
  ipo_open: IconCalendar,
  ipo_closing: IconClock,
  allotment_out: IconBell,
  allotment_result: IconTarget,
  listing_day: IconTrend,
  gmp_move: IconTrend,
};

const TOGGLES: { key: keyof AlertPrefs; title: string; sub: string }[] = [
  { key: 'ipo_open', title: 'IPO opens', sub: 'When a new issue opens' },
  { key: 'ipo_closing', title: 'Closing soon', sub: 'A day before, and on the last day' },
  { key: 'allotment_out', title: 'Allotment results', sub: 'The moment results go live, with your totals' },
  { key: 'listing_day', title: 'Listing day', sub: 'When an IPO you tracked lists' },
  { key: 'gmp_moves', title: 'GMP moves', sub: 'When the premium shifts sharply' },
  { key: 'only_watchlist', title: 'Watchlist only', sub: 'Mute IPOs you have not starred' },
];

export function AlertsScreen() {
  const navigation = useAppNavigation();
  const t = useTheme();
  const s = makeStyles(t);
  const queryClient = useQueryClient();
  const [pushState, setPushState] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: notifications, refetch, isRefetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications,
  });
  const { data: prefs } = useQuery({ queryKey: ['prefs'], queryFn: api.prefs });

  const savePrefs = useMutation({
    mutationFn: (patch: Record<string, boolean | number>) => api.savePrefs(patch),
    onSuccess: (data) => queryClient.setQueryData(['prefs'], data),
  });

  const markRead = useMutation({
    mutationFn: () => api.markRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['unread'] });
    },
  });

  const unread = (notifications ?? []).filter((n) => !n.readAt).length;

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.accent} />}
    >
      <Text style={s.title}>Alerts</Text>
      <Text style={s.sub}>IPO events and allotment results, pushed to you.</Text>

      {pushState?.ok ? (
        <Banner tone="success">Notifications are on for this device.</Banner>
      ) : (
        <Card style={{ padding: 16, marginBottom: 18 }}>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>Turn on notifications</Text>
          <Text style={{ color: t.textDim, fontSize: 13, marginTop: 4, marginBottom: 12 }}>
            Get told when allotment is out and how many of your accounts got shares.
          </Text>
          {pushState?.reason && <Banner tone="error">{pushState.reason}</Banner>}
          <Button
            title="Enable notifications"
            loading={busy}
            onPress={async () => {
              setBusy(true);
              setPushState(await registerForPush());
              setBusy(false);
            }}
          />
        </Card>
      )}

      <SectionTitle title="Notifications" right={unread > 0 ? `${unread} unread` : undefined} />
      {unread > 0 && (
        <View style={{ marginBottom: 10 }}>
          <Button title="Mark all read" variant="plain" onPress={() => markRead.mutate()} />
        </View>
      )}

      {(notifications ?? []).length === 0 ? (
        <Empty icon={IconBell} text="Nothing yet. We will tell you when an IPO opens or allotment is out." />
      ) : (
        <Card>
          {notifications!.map((n, index) => {
            const Icon = KIND_ICON[n.kind] ?? IconBell;
            return (
            <Pressable
              key={n.id}
              onPress={() => n.ipoId && navigation.navigate('IpoDetail', { id: n.ipoId, name: n.ipoName })}
              style={{
                flexDirection: 'row',
                gap: 11,
                padding: 13,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: t.border,
                backgroundColor: n.readAt ? undefined : t.accentSubtle,
              }}
            >
              <Icon size={17} color={t.textDim} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>{n.title}</Text>
                <Text style={{ color: t.textDim, fontSize: 12.5, marginTop: 2 }}>{n.body}</Text>
              </View>
              <Text style={{ color: t.textFaint, fontSize: 11 }}>{relativeTime(n.createdAt)}</Text>
            </Pressable>
            );
          })}
        </Card>
      )}

      <View style={{ marginTop: 22 }}>
        <SectionTitle title="What to notify me about" />
        <Card>
          {TOGGLES.map((toggle, index) => (
            <View
              key={toggle.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 11,
                padding: 13,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: t.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>{toggle.title}</Text>
                <Text style={{ color: t.textFaint, fontSize: 11.5 }}>{toggle.sub}</Text>
              </View>
              <Switch
                value={Boolean(prefs?.[toggle.key])}
                onValueChange={(v) => savePrefs.mutate({ [toggle.key]: v })}
                trackColor={{ true: t.accent, false: t.border }}
              />
            </View>
          ))}
        </Card>
      </View>
    </ScrollView>
  );
}
