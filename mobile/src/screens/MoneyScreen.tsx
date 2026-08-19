import { useQuery } from '@tanstack/react-query';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Card, Empty, Logo, SectionTitle, Stat, makeStyles } from '../components';
import { REFUND_LABEL } from '../components/ApplyPanel';
import { money, num, shortDate } from '../format';
import { IconWallet } from '../icons';
import { useAppNavigation } from '../navigation';
import { api } from '../queries';
import { useTheme } from '../theme';
import type { RefundStatus } from '../types';

export function MoneyScreen() {
  const t = useTheme();
  const s = makeStyles(t);
  const navigation = useAppNavigation();

  const { data: summary, refetch, isRefetching } = useQuery({
    queryKey: ['money-summary'],
    queryFn: api.moneySummary,
  });
  const { data: rows } = useQuery({ queryKey: ['money-by-ipo'], queryFn: api.moneyByIpo });

  const badgeColor = (status: RefundStatus) => {
    if (status === 'refund_pending') return { bg: t.warnSubtle, fg: t.warn };
    if (status === 'refund_received' || status === 'debited') return { bg: t.posSubtle, fg: t.pos };
    return { bg: t.surface3, fg: t.textDim };
  };

  const hasAny = (summary?.applicationCount ?? 0) > 0;

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.accent} />}
    >
      <Text style={s.title}>Money</Text>
      <Text style={s.sub}>What you applied for, and where that money is right now.</Text>

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
                  </View>
                </Pressable>
              );
            })}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
