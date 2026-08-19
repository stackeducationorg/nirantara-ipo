import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
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

      {isLoading ? (
        <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />
      ) : (
        <>
          {data && data.awaitingAllotment.length > 0 &&
            section('Awaiting allotment', data.awaitingAllotment, '')}
          {section('Open now', data?.open, 'No IPOs are open right now.')}
          {section('Upcoming', data?.upcoming, 'No upcoming IPOs announced yet.')}
          {data && data.recentlyListed.length > 0 && section('Recently listed', data.recentlyListed, '')}
        </>
      )}
    </ScrollView>
  );
}
