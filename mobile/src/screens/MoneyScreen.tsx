import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Card, Empty, Logo, SectionTitle, Stat, makeStyles } from '../components';
import { ApplyPanel, REFUND_LABEL } from '../components/ApplyPanel';
import { SendersPanel } from '../components/SendersPanel';
import { money, num, shortDate } from '../format';
import { IconWallet } from '../icons';
import { useAppNavigation } from '../navigation';
import { api } from '../queries';
import { useTheme } from '../theme';
import type { Ipo, RefundStatus } from '../types';

/**
 * Two kinds of people put money through this page, and they need different records.
 *
 * `ledger`   the regular applicant: their own PANs, ten or fifteen issues, lots and refunds
 *            tracked per IPO. This is the original view, unchanged.
 * `onetime`  someone who sends the amount for a single application. Name, amount, and
 *            whether it went back — nothing else is worth asking them for.
 */
type MoneyTab = 'ledger' | 'onetime';

export function MoneyScreen() {
  const t = useTheme();
  const s = makeStyles(t);
  const navigation = useAppNavigation();
  const [tab, setTab] = useState<MoneyTab>('ledger');

  const { data: summary, refetch, isRefetching } = useQuery({
    queryKey: ['money-summary'],
    queryFn: api.moneySummary,
  });
  const { data: rows } = useQuery({ queryKey: ['money-by-ipo'], queryFn: api.moneyByIpo });
  const { data: dashboard } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const queryClient = useQueryClient();

  // Recording an application lives here rather than on the IPO screen, so everything to do
  // with money is in one place — matching the website.
  const [selectedId, setSelectedId] = useState('');
  const selectable: Ipo[] = useMemo(
    () => (dashboard ? [...dashboard.open, ...dashboard.awaitingAllotment, ...dashboard.upcoming] : []),
    [dashboard],
  );
  const selected = selectable.find((i) => i.id === selectedId) ?? null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['money-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['money-by-ipo'] });
    void queryClient.invalidateQueries({ queryKey: ['applications'] });
  };
  /** Pull-to-refresh has to reach whichever list is showing, not just the ledger. */
  const onRefresh = () => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ['senders'] });
  };

  const refundIpo = useMutation({ mutationFn: (id: string) => api.markIpoRefund(id, true), onSuccess: invalidate });
  const resetIpo = useMutation({ mutationFn: (id: string) => api.resetIpoApplications(id), onSuccess: invalidate });

  const badgeColor = (status: RefundStatus) => {
    if (status === 'refund_pending') return { bg: t.warnSubtle, fg: t.warn };
    if (status === 'refund_received' || status === 'debited') return { bg: t.posSubtle, fg: t.pos };
    return { bg: t.surface3, fg: t.textDim };
  };

  const hasAny = (summary?.applicationCount ?? 0) > 0;

  const picker = (
    <Card style={{ marginBottom: 16 }}>
      <Text style={{ color: t.text, fontWeight: '700', fontSize: 14, marginBottom: 10 }}>
        Record an application
      </Text>
      {selectable.length === 0 ? (
        <Text style={{ color: t.textFaint, fontSize: 12.5 }}>
          No IPOs are open or awaiting allotment right now.
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {selectable.map((ipo) => {
            const on = ipo.id === selectedId;
            return (
              <Pressable
                key={ipo.id}
                onPress={() => setSelectedId(on ? '' : ipo.id)}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: on ? t.accent : t.border,
                  backgroundColor: on ? t.accentSubtle : 'transparent',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: on ? t.accent : t.textDim }}>
                  {ipo.name}
                  {ipo.category === 'SME' ? ' (SME)' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Card>
  );

  // Beside the ledger rather than buried under it: the two records are alternatives, and a
  // one-time sender has nothing to read in the per-IPO view.
  const tabBar = (
    <View
      style={{
        flexDirection: 'row',
        gap: 6,
        backgroundColor: t.surface2,
        borderRadius: 10,
        padding: 4,
        marginBottom: 16,
      }}
    >
      {([
        ['ledger', 'IPO ledger'],
        ['onetime', 'One-time'],
      ] as [MoneyTab, string][]).map(([key, label]) => {
        const on = tab === key;
        return (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 7,
              alignItems: 'center',
              backgroundColor: on ? t.surface : 'transparent',
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: on ? t.text : t.textDim }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={t.accent} />}
    >
      <Text style={s.title}>Money</Text>
      <Text style={s.sub}>
        {tab === 'ledger'
          ? 'What you applied for, and where that money is right now.'
          : 'People who sent money once. Mark it when it goes back to them.'}
      </Text>

      {tabBar}

      {tab === 'onetime' ? (
        <SendersPanel />
      ) : (
        <>
          {picker}
          {selected && <ApplyPanel ipo={selected} />}

          {!hasAny ? (
            <Empty
              icon={IconWallet}
              text="Nothing recorded yet. Open an IPO and mark how many lots you applied for from each account."
            />
          ) : (
            <>
              <Card style={{ padding: 16, marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', marginBottom: 14 }}>
                  <Stat label="Blocked" value={money(summary!.totalBlocked)} />
                  <Stat label="Refund due" value={money(summary!.refundPending)} />
                </View>
                <View style={{ flexDirection: 'row' }}>
                  <Stat label="Refunded" value={money(summary!.refundReceived)} />
                  <Stat label="Invested" value={money(summary!.totalInvested)} />
                </View>
              </Card>

              <SectionTitle title="By IPO" right={`${rows?.length ?? 0}`} />
              <Card>
                {(rows ?? []).map((row, index) => {
                  const badge = badgeColor(row.refundStatus);
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
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                          {row.ipoName}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                          <View
                            style={{
                              backgroundColor: badge.bg,
                              borderRadius: 4,
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                            }}
                          >
                            <Text style={{ color: badge.fg, fontSize: 9.5, fontWeight: '700' }}>
                              {REFUND_LABEL[row.refundStatus].toUpperCase()}
                            </Text>
                          </View>
                          <Text style={{ color: t.textFaint, fontSize: 11.5 }}>
                            {row.accounts} acct · {num(row.totalLots)} lots
                            {row.boaDate ? ` · ${shortDate(row.boaDate)}` : ''}
                          </Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: t.text, fontWeight: '600', fontSize: 13.5 }}>
                          {money(row.amountBlocked)}
                        </Text>
                        <Text style={{ color: t.textFaint, fontSize: 11 }}>
                          {row.allottedShares > 0
                            ? `${num(row.allottedShares)} sh`
                            : row.refundAmount > 0
                              ? `${money(row.refundAmount)} back`
                              : 'pending'}
                        </Text>

                        {/* Offered while still 'blocked' too: money can come back before the
                            registrar answers, and the ledger should not wait on that. */}
                        {(row.refundStatus === 'refund_pending' || row.refundStatus === 'blocked') && (
                          <Pressable
                            onPress={() => refundIpo.mutate(row.ipoId)}
                            disabled={refundIpo.isPending}
                            style={{
                              marginTop: 6,
                              paddingVertical: 5,
                              paddingHorizontal: 11,
                              borderRadius: 7,
                              backgroundColor: t.posSubtle,
                            }}
                          >
                            <Text style={{ color: t.pos, fontSize: 11.5, fontWeight: '700' }}>
                              Got it back
                            </Text>
                          </Pressable>
                        )}

                        {/* Escape hatch: clears this IPO whatever state it is in, settled refunds
                            included, so a mis-entry can be redone. */}
                        <Pressable
                          onPress={() =>
                            Alert.alert(
                              `Reset ${row.ipoName}?`,
                              `This removes all ${row.accounts} account entr${
                                row.accounts === 1 ? 'y' : 'ies'
                              } for this IPO, including any refund already marked received. It cannot be undone.`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Reset', style: 'destructive', onPress: () => resetIpo.mutate(row.ipoId) },
                              ],
                            )
                          }
                          disabled={resetIpo.isPending}
                          style={{ marginTop: 5, paddingVertical: 4, paddingHorizontal: 9 }}
                        >
                          <Text style={{ color: t.textFaint, fontSize: 11, fontWeight: '600' }}>Reset</Text>
                        </Pressable>
                      </View>
                    </Pressable>
                  );
                })}
              </Card>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
