import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Banner, Card, Logo, Pill, makeStyles } from '../components';
import { gmpPerLot, gmpText, gmpTone, money, relativeTime, signedMoney, statusLabel } from '../format';
import { useAppNavigation } from '../navigation';
import { api } from '../queries';
import { useTheme } from '../theme';

type Filter = 'all' | 'IPO' | 'SME';

export function GmpScreen() {
  const navigation = useAppNavigation();
  const t = useTheme();
  const s = makeStyles(t);
  const [filter, setFilter] = useState<Filter>('all');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['gmp-board'],
    queryFn: api.gmpBoard,
  });

  const items = (data ?? []).filter((i) => filter === 'all' || i.category === filter);

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.accent} />}
    >
      <Text style={s.title}>Live GMP</Text>
      <Text style={s.sub}>Grey market premium, highest first.</Text>

      <View style={{ flexDirection: 'row', gap: 7, marginBottom: 14 }}>
        {(['all', 'IPO', 'SME'] as Filter[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={{
              backgroundColor: filter === f ? t.accent : t.surface,
              borderColor: filter === f ? t.accent : t.border,
              borderWidth: 1,
              borderRadius: 999,
              paddingHorizontal: 14,
              paddingVertical: 6,
            }}
          >
            <Text style={{ color: filter === f ? '#fff' : t.textDim, fontWeight: '600', fontSize: 12.5 }}>
              {f === 'all' ? 'All' : f === 'IPO' ? 'Mainboard' : 'SME'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Banner tone="warn">GMP is an unofficial market signal, not a prediction or investment advice.</Banner>

      {isLoading ? (
        <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />
      ) : (
        <Card>
          {items.map((ipo, index) => {
            const tone = gmpTone(ipo.gmp);
            // GMP is per share; per lot is what someone applying actually needs.
            const perLot = gmpPerLot(ipo.gmp, ipo.lotSize);
            const toneColor = tone === 'up' ? t.pos : tone === 'down' ? t.neg : t.textFaint;

            return (
              <Pressable
                key={ipo.id}
                onPress={() => navigation.navigate('IpoDetail', { id: ipo.id, name: ipo.name })}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 11,
                  padding: 13,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: t.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Logo ipo={ipo} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                    {ipo.name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <Pill label={statusLabel(ipo.status)} status={ipo.status} />
                    <Text style={{ color: t.textFaint, fontSize: 11.5 }} numberOfLines={1}>
                      ₹{ipo.priceText} · {money(ipo.lotAmount)}
                    </Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: toneColor, fontWeight: '700', fontSize: 16 }}>{gmpText(ipo.gmp)}</Text>
                  {perLot !== null && perLot !== 0 && (
                    <Text style={{ color: toneColor, fontWeight: '600', fontSize: 12 }}>
                      {signedMoney(perLot)}/lot
                    </Text>
                  )}
                  <Text style={{ color: t.textFaint, fontSize: 10.5 }}>
                    {[
                      ipo.gmp !== 0 && ipo.gmpPercent !== null ? `${ipo.gmpPercent}%` : null,
                      ipo.gmpUpdatedAt ? relativeTime(ipo.gmpUpdatedAt) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}
    </ScrollView>
  );
}
