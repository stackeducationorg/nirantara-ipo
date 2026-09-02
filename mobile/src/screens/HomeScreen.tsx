import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Banner, Empty, IpoRow, SectionTitle, makeStyles } from '../components';
import { IconInbox } from '../icons';
import { useAppNavigation } from '../navigation';
import { api } from '../queries';
import { useTheme } from '../theme';
import type { Ipo } from '../types';

export function HomeScreen() {
  const navigation = useAppNavigation();
  const t = useTheme();
  const s = makeStyles(t);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
  });
  const { data: pans } = useQuery({ queryKey: ['pans'], queryFn: api.pans });

  // SME issues outnumber mainboard roughly two to one, so a single mixed list buries the
  // mainboard IPOs most people are looking for. The toggle switches between them.
  const [smeOnly, setSmeOnly] = useState(false);
  const only = (items: Ipo[] | undefined): Ipo[] =>
    (items ?? []).filter((ipo) => (smeOnly ? ipo.category === 'SME' : ipo.category !== 'SME'));

  const open = (ipo: Ipo) => navigation.navigate('IpoDetail', { id: ipo.id, name: ipo.name });

  const section = (title: string, items: Ipo[] | undefined, empty: string) => (
    <View style={{ marginBottom: 22 }}>
      <SectionTitle title={title} right={`${items?.length ?? 0}`} />
      {items && items.length > 0 ? (
        items.map((ipo) => <IpoRow key={ipo.id} ipo={ipo} onPress={() => open(ipo)} />)
      ) : (
        <Empty icon={IconInbox} text={empty} />
      )}
    </View>
  );

  const inAllotmentWindow = only(data?.awaitingAllotment);
  const resultsOut = inAllotmentWindow.filter((i) => i.allotmentLive);
  const awaiting = inAllotmentWindow.filter((i) => !i.allotmentLive);
  const listed = only(data?.recentlyListed);
  const kind = smeOnly ? 'SME' : 'mainboard';

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.accent} />}
    >
      <Text style={s.title}>IPO Dashboard</Text>
      <Text style={s.sub}>Live GMP, subscription and allotment tracking</Text>

      {pans && pans.length === 0 && (
        <Banner tone="info">Add your PAN to check allotment across every account automatically.</Banner>
      )}

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
        {([false, true] as const).map((sme) => (
          <Pressable
            key={String(sme)}
            onPress={() => setSmeOnly(sme)}
            style={{
              paddingVertical: 7,
              paddingHorizontal: 15,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: smeOnly === sme ? t.accent : t.border,
              backgroundColor: smeOnly === sme ? t.accentSubtle : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: smeOnly === sme ? t.accent : t.textDim,
              }}
            >
              {sme ? 'SME' : 'Mainboard'}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* The date-derived status only says the allotment window has opened. Splitting on
              whether the registrar is actually answering stops a published result reading as
              "awaiting". */}
          {resultsOut.length > 0 && section('Results out', resultsOut, '')}
          {section('Open now', only(data?.open), `No ${kind} IPOs are open right now.`)}
          {awaiting.length > 0 && section('Awaiting allotment', awaiting, '')}
          {section('Upcoming', only(data?.upcoming), `No upcoming ${kind} IPOs announced yet.`)}
          {listed.length > 0 && section('Recently listed', listed, '')}
        </>
      )}
    </ScrollView>
  );
}
