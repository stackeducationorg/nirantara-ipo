import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Button, Card, Empty, Logo, SectionTitle, Stat, makeStyles } from '../components';
import { money, num, relativeTime, shortDate } from '../format';
import { IconChevronRight, IconInbox, IconWallet } from '../icons';
import { useAppNavigation } from '../navigation';
import { api } from '../queries';
import { useTheme } from '../theme';

export function AllotmentScreen() {
  const navigation = useAppNavigation();
  const t = useTheme();
  const s = makeStyles(t);
  const queryClient = useQueryClient();

  const { data: history, refetch, isRefetching } = useQuery({
    queryKey: ['allotment-history'],
    queryFn: api.allotmentHistory,
  });
  const { data: pans } = useQuery({ queryKey: ['pans'], queryFn: api.pans });
  const { data: dashboard } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });

  const checkAll = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      // Captcha registrars never answer the server; those issues are swept by an operator
      // instead, so asking here would only produce a failure the user cannot act on.
      const due = (dashboard?.awaitingAllotment ?? []).filter(
        (i) => i.boaDate && i.boaDate <= today && !i.registrarNeedsCaptcha,
      );
      const settled = await Promise.allSettled(due.map((i) => api.checkAllotment(i.id)));
      return settled.filter((r) => r.status === 'fulfilled').length;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['allotment-history'] }),
  });

  const active = (pans ?? []).filter((p) => p.isActive);
  const totalWon = (history ?? []).reduce((sum, r) => sum + r.totalAmount, 0);
  const totalAllotted = (history ?? []).reduce((sum, r) => sum + r.allottedAccounts, 0);

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.accent} />}
    >
      <Text style={s.title}>Allotment</Text>
      <Text style={s.sub}>Every saved PAN, checked together.</Text>

      {active.length === 0 ? (
        <Empty icon={IconWallet} text="No PANs saved yet. Add one from the Accounts tab." />
      ) : (
        <>
          <Card style={{ padding: 16, marginBottom: 18 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <Stat label="Accounts" value={String(active.length)} />
              <Stat label="Allotments" value={String(totalAllotted)} />
              <Stat label="Total value" value={money(totalWon)} />
            </View>
            <View style={{ marginTop: 16 }}>
              <Button
                title="Re-check all pending IPOs"
                onPress={() => checkAll.mutate()}
                loading={checkAll.isPending}
              />
            </View>
          </Card>

          {dashboard && dashboard.awaitingAllotment.length > 0 && (
            <View style={{ marginBottom: 22 }}>
              <SectionTitle title="Waiting on results" />
              <Card>
                {dashboard.awaitingAllotment.map((ipo, index) => (
                  <Pressable
                    key={ipo.id}
                    onPress={() => navigation.navigate('IpoDetail', { id: ipo.id, name: ipo.name })}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 11,
                      padding: 13,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: t.border,
                    }}
                  >
                    <Logo ipo={ipo} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>{ipo.name}</Text>
                      <Text style={{ color: t.textFaint, fontSize: 11.5 }}>
                        Allotment {shortDate(ipo.boaDate)}
                      </Text>
                    </View>
                    <IconChevronRight size={16} color={t.textFaint} />
                  </Pressable>
                ))}
              </Card>
            </View>
          )}

          <SectionTitle title="History" />
          {(history ?? []).length === 0 ? (
            <Empty icon={IconInbox} text="No allotments checked yet." />
          ) : (
            <Card>
              {history!.map((row, index) => {
                const won = row.allottedAccounts > 0;
                return (
                  <Pressable
                    key={row.ipoId}
                    onPress={() => navigation.navigate('IpoDetail', { id: row.ipoId, name: row.ipoName })}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 11,
                      padding: 13,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: t.border,
                    }}
                  >
                    <Logo ipo={{ name: row.ipoName, logoUrl: row.logoUrl }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>{row.ipoName}</Text>
                      <Text style={{ color: t.textFaint, fontSize: 11.5 }}>
                        {shortDate(row.boaDate)} · checked {relativeTime(row.checkedAt)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: won ? t.pos : t.textFaint, fontWeight: '700' }}>
                        {row.allottedAccounts}/{row.totalAccounts}
                      </Text>
                      <Text style={{ color: t.textFaint, fontSize: 11 }}>
                        {won ? `${num(row.totalShares)} sh · ${money(row.totalAmount)}` : 'no allotment'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}
