import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Banner, Button, Card, Logo, Pill, Stat, makeStyles } from '../components';
import { ApplyPanel } from '../components/ApplyPanel';
import { gmpText, gmpTone, money, num, relativeTime, shortDate, statusLabel } from '../format';
import { useAppNavigation, type RootStackParamList } from '../navigation';
import { api } from '../queries';
import { useTheme } from '../theme';
import type { AllotmentResult, Ipo } from '../types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/** Half-width cell for the two-column stat grid on this screen. */
const half = { width: '50%' as const };

const STATUS_TEXT: Record<AllotmentResult['status'], string> = {
  allotted: 'Allotted',
  not_allotted: 'Not allotted',
  not_applied: 'No application found',
  pending: 'Awaiting results',
  error: 'Check failed',
};

/**
 * Allotted first, then applications that missed out; everything else sinks. "No application
 * found" stays uncoloured — that account simply did not apply, which is not a bad outcome.
 */
const STATUS_RANK: Record<AllotmentResult['status'], number> = {
  allotted: 0,
  not_allotted: 1,
  pending: 2,
  error: 3,
  not_applied: 4,
};

function byOutcome(a: AllotmentResult, b: AllotmentResult): number {
  const diff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  return diff !== 0 ? diff : (b.allottedQty ?? 0) - (a.allottedQty ?? 0);
}

function Timeline({ ipo }: { ipo: Ipo }) {
  const t = useTheme();
  const today = new Date().toISOString().slice(0, 10);
  const steps = [
    { label: 'Opens', date: ipo.openDate },
    { label: 'Closes', date: ipo.closeDate },
    { label: 'Allotment', date: ipo.boaDate },
    { label: 'Lists', date: ipo.listingDate },
  ].filter((s) => s.date);

  return (
    <View>
      {steps.map((step) => {
        const done = step.date! < today;
        const now = step.date === today;
        return (
          <View key={step.label} style={{ flexDirection: 'row', gap: 12, marginBottom: 14, alignItems: 'center' }}>
            <View
              style={{
                width: 11,
                height: 11,
                borderRadius: 6,
                backgroundColor: done ? t.pos : now ? t.accent : t.border,
              }}
            />
            <Text style={{ color: t.text, fontWeight: '600', fontSize: 14, flex: 1 }}>{step.label}</Text>
            <Text style={{ color: now ? t.accent : t.textFaint, fontSize: 13 }}>
              {shortDate(step.date)}
              {now ? ' · today' : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** The allotment sweep, mirroring the web panel: every saved PAN checked in one action. */
function AllotmentPanel({ ipo }: { ipo: Ipo }) {
  const navigation = useAppNavigation();
  const t = useTheme();
  const queryClient = useQueryClient();

  const { data: pans } = useQuery({ queryKey: ['pans'], queryFn: api.pans });
  const { data: summary } = useQuery({
    queryKey: ['allotment', ipo.id],
    queryFn: () => api.allotment(ipo.id),
  });

  const check = useMutation({
    mutationFn: () => api.checkAllotment(ipo.id),
    onSuccess: (data) => {
      queryClient.setQueryData(['allotment', ipo.id], data);
      void queryClient.invalidateQueries({ queryKey: ['allotment-history'] });
    },
  });

  const active = (pans ?? []).filter((p) => p.isActive);
  const today = new Date().toISOString().slice(0, 10);
  const beforeAllotment = Boolean(ipo.boaDate && today < ipo.boaDate);

  if (active.length === 0) {
    return (
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 15, marginBottom: 5 }}>Allotment</Text>
        <Text style={{ color: t.textDim, fontSize: 13.5, marginBottom: 14 }}>
          Save your PANs once and every future IPO is checked across all of them automatically.
        </Text>
        {/* Accounts lives in the tab navigator nested under this stack. */}
        <Button title="Add a PAN" onPress={() => navigation.navigate('Tabs', { screen: 'Accounts' })} />
      </Card>
    );
  }

  const results = summary?.results ?? [];
  const live = summary?.checked && summary.resultsLive;

  return (
    <Card style={{ marginBottom: 14, padding: 16 }}>
      <Text style={{ color: t.text, fontWeight: '700', fontSize: 15, marginBottom: 10 }}>Allotment</Text>

      {live && (
        <View style={{ alignItems: 'center', marginBottom: 14 }}>
          <Text
            style={{
              color: summary!.allottedAccounts > 0 ? t.pos : t.text,
              fontSize: 38,
              fontWeight: '800',
            }}
          >
            {summary!.allottedAccounts}
            <Text style={{ color: t.textFaint, fontSize: 20 }}> / {summary!.totalAccounts}</Text>
          </Text>
          <Text style={{ color: t.textDim, fontSize: 14 }}>
            {summary!.allottedAccounts > 0 ? 'accounts allotted' : 'accounts allotted — nothing this time'}
          </Text>
          {summary!.allottedAccounts > 0 && (
            <View
              style={{
                flexDirection: 'row',
                gap: 22,
                marginTop: 12,
                backgroundColor: t.surface2,
                borderRadius: 12,
                paddingVertical: 10,
                paddingHorizontal: 18,
              }}
            >
              <Stat label="Shares" value={num(summary!.totalShares)} />
              <Stat label="Value" value={money(summary!.totalAmount)} />
            </View>
          )}
        </View>
      )}

      {beforeAllotment && (
        <Banner tone="info">
          Allotment is expected on {shortDate(ipo.boaDate)}. We check it automatically the moment results go
          live and notify you.
        </Banner>
      )}

      {[...results].sort(byOutcome).map((r) => (
        <View
          key={r.panId}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 11,
            paddingVertical: 11,
            borderTopWidth: 1,
            borderTopColor: t.border,
          }}
        >
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor:
                r.status === 'allotted'
                  ? t.pos
                  : r.status === 'not_allotted' || r.status === 'error'
                    ? t.neg
                    : t.textFaint,
            }}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
              {r.nameOnRecord ?? r.label}{' '}
              <Text style={{ color: t.textFaint, fontWeight: '400' }}>{r.panMasked}</Text>
            </Text>
            <Text style={{ color: t.textFaint, fontSize: 11.5 }} numberOfLines={1}>
              {r.nameOnRecord ? `${r.label} · ` : ''}
              <Text
                style={{
                  color:
                    r.status === 'allotted'
                      ? t.pos
                      : r.status === 'not_allotted' || r.status === 'error'
                        ? t.neg
                        : t.textFaint,
                  fontWeight: r.status === 'allotted' || r.status === 'not_allotted' ? '600' : '400',
                }}
              >
                {STATUS_TEXT[r.status]}
              </Text>
            </Text>
          </View>
          {r.status === 'allotted' && (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: t.pos, fontWeight: '700' }}>{num(r.allottedQty)}</Text>
              <Text style={{ color: t.textFaint, fontSize: 11 }}>{money(r.amount)}</Text>
            </View>
          )}
        </View>
      ))}

      {check.isError && <Banner tone="error">{(check.error as Error).message}</Banner>}

      <View style={{ marginTop: 14 }}>
        {/*
          Captcha registrars never answer the server. An operator reads one challenge and spends
          it across every account's book, so the applicant is told their result without lifting a
          finger — asking them to press "check" here would only fail. NSE is offered underneath
          for anyone who would rather not wait for that sweep.
        */}
        {ipo.registrarNeedsCaptcha && !beforeAllotment ? (
          <>
            <Banner tone="info">
              This registrar needs a code read by a person, so we solve it once for everyone and
              send your result the moment it lands. Nothing for you to do.
            </Banner>
            {ipo.nseSymbol && ipo.nseBidVerifyUrl && (
              <Pressable
                onPress={() => void Linking.openURL(ipo.nseBidVerifyUrl!)}
                style={{ paddingVertical: 11, alignItems: 'center' }}
              >
                <Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>
                  See it now on NSE — symbol {ipo.nseSymbol} ↗
                </Text>
              </Pressable>
            )}
          </>
        ) : (
        <Button
          title={
            beforeAllotment
              ? `Auto-check on ${shortDate(ipo.boaDate)}`
              : `Check all ${active.length} account${active.length > 1 ? 's' : ''} now`
          }
          onPress={() => check.mutate()}
          disabled={beforeAllotment}
          loading={check.isPending}
        />
        )}
        {results.length > 0 && (
          <Text style={{ color: t.textFaint, fontSize: 11.5, textAlign: 'center', marginTop: 8 }}>
            Last checked {relativeTime(results[0].checkedAt)}
          </Text>
        )}
      </View>
    </Card>
  );
}

type Props = NativeStackScreenProps<RootStackParamList, 'IpoDetail'>;

export function IpoDetailScreen({ route }: Props) {
  const t = useTheme();
  const s = makeStyles(t);
  const { data: ipo, isLoading } = useQuery({
    queryKey: ['ipo', route.params.id],
    queryFn: () => api.ipo(route.params.id),
  });

  if (isLoading || !ipo) {
    return (
      <View style={[s.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  const tone = gmpTone(ipo.gmp);
  const toneColor = tone === 'up' ? t.pos : tone === 'down' ? t.neg : t.textFaint;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <Logo ipo={ipo} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{ipo.name}</Text>
            <View style={{ flexDirection: 'row', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
              <Pill label={statusLabel(ipo.status)} status={ipo.status} />
              {ipo.category === 'SME' && <Pill label="SME" />}
              {ipo.exchange && <Pill label={ipo.exchange} />}
            </View>
          </View>
          {ipo.gmp !== null && (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: toneColor, fontWeight: '800', fontSize: 21 }}>{gmpText(ipo.gmp)}</Text>
              <Text style={{ color: t.textFaint, fontSize: 10.5 }}>
                GMP {ipo.gmp !== 0 && ipo.gmpPercent !== null ? `${ipo.gmpPercent}%` : ''}
              </Text>
            </View>
          )}
        </View>

        {/*
          Two-column grid. The width goes on the Stat itself: wrapping each one in a sized
          View left Stat's default `flex: 1` resolving against the wrapper's auto height,
          which is what collapsed the cells.
        */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, marginTop: 18 }}>
          <Stat style={half} label="Price band" value={ipo.priceText ? `₹${ipo.priceText}` : '—'} />
          <Stat style={half} label="Lot size" value={String(ipo.lotSize ?? '—')} />
          <Stat style={half} label="Min investment" value={money(ipo.lotAmount)} />
          <Stat style={half} label="Issue size" value={ipo.issueSize ?? '—'} />
          <Stat style={half} label="Est. listing" value={money(ipo.estListingPrice)} />
          <Stat style={half} label="Registrar" value={ipo.registrar ?? 'TBD'} />
        </View>
      </Card>

      <ApplyPanel ipo={ipo} />
      <AllotmentPanel ipo={ipo} />

      <Card style={{ padding: 16 }}>
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 15, marginBottom: 14 }}>Timeline</Text>
        <Timeline ipo={ipo} />
      </Card>
    </ScrollView>
  );
}
