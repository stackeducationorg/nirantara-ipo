import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, Text, View } from 'react-native';
import { Banner, Button, Card, Stat } from '../components';
import { money, num } from '../format';
import { IconCheck, IconClock, IconWallet } from '../icons';
import { useAppNavigation } from '../navigation';
import { api } from '../queries';
import { useTheme, type Theme } from '../theme';
import type { ApplicationBoard, Ipo, RefundStatus } from '../types';

export const REFUND_LABEL: Record<RefundStatus, string> = {
  blocked: 'Funds blocked',
  refund_pending: 'Refund due',
  refund_received: 'Refund received',
  debited: 'Fully allotted',
};

function LotStepper({
  lots,
  onChange,
  disabled,
  theme,
}: {
  lots: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  theme: Theme;
}) {
  const button = (label: string, next: number, off: boolean) => (
    <Pressable
      onPress={() => onChange(next)}
      disabled={disabled || off}
      hitSlop={6}
      style={{ width: 32, height: 30, alignItems: 'center', justifyContent: 'center', opacity: off ? 0.35 : 1 }}
    >
      <Text style={{ color: theme.textDim, fontSize: 17 }}>{label}</Text>
    </Pressable>
  );

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {button('−', Math.max(0, lots - 1), lots === 0)}
      {/* Fixed width stops the row jumping as the count changes. */}
      <Text style={{ color: theme.text, fontWeight: '600', minWidth: 26, textAlign: 'center' }}>{lots}</Text>
      {button('+', lots + 1, lots >= 1000)}
    </View>
  );
}

function RefundControl({
  status,
  busy,
  onToggle,
  theme,
}: {
  status: RefundStatus;
  busy: boolean;
  onToggle: (received: boolean) => void;
  theme: Theme;
}) {
  if (status === 'debited') {
    return (
      <View style={{ backgroundColor: theme.posSubtle, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 }}>
        <Text style={{ color: theme.pos, fontSize: 10, fontWeight: '700' }}>ALLOTTED</Text>
      </View>
    );
  }

  if (status === 'refund_received') {
    return (
      <Pressable onPress={() => onToggle(false)} disabled={busy} hitSlop={8}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <IconCheck size={14} color={theme.pos} />
          <Text style={{ color: theme.pos, fontSize: 12.5, fontWeight: '600' }}>Refunded</Text>
        </View>
      </Pressable>
    );
  }

  if (status === 'refund_pending') {
    return (
      <Pressable
        onPress={() => onToggle(true)}
        disabled={busy}
        style={{
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
        }}
      >
        <Text style={{ color: theme.text, fontSize: 12.5, fontWeight: '600' }}>Mark refunded</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <IconClock size={13} color={theme.textFaint} />
      <Text style={{ color: theme.textFaint, fontSize: 12 }}>Blocked</Text>
    </View>
  );
}

/** Records how many lots were applied for from each saved PAN, and settles the money after allotment. */
export function ApplyPanel({ ipo }: { ipo: Ipo }) {
  const t = useTheme();
  const navigation = useAppNavigation();
  const queryClient = useQueryClient();

  const { data: board, isLoading } = useQuery({
    queryKey: ['applications', ipo.id],
    queryFn: () => api.applicationBoard(ipo.id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['applications', ipo.id] });
    void queryClient.invalidateQueries({ queryKey: ['money-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['money-by-ipo'] });
  };

  const save = useMutation({
    mutationFn: ({ panId, lots }: { panId: string; lots: number }) => api.saveApplication(ipo.id, { panId, lots }),
    onSuccess: invalidate,
  });
  const applyAll = useMutation({ mutationFn: (lots: number) => api.applyAll(ipo.id, lots), onSuccess: invalidate });
  const refund = useMutation({
    mutationFn: ({ id, received }: { id: string; received: boolean }) => api.markRefund(id, received),
    onSuccess: invalidate,
  });

  if (isLoading) return null;

  if (!board || board.accounts.length === 0) {
    return (
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 15, marginBottom: 5 }}>Your application</Text>
        <Text style={{ color: t.textDim, fontSize: 13.5, marginBottom: 14 }}>
          Add your PANs to record how much you applied for from each account.
        </Text>
        <Button title="Add a PAN" onPress={() => navigation.navigate('Tabs', { screen: 'Accounts' })} />
      </Card>
    );
  }

  const applied = board.accounts.filter((a) => a.application);
  const blocked = applied.reduce((sum, a) => sum + (a.application?.amountBlocked ?? 0), 0);
  const lots = applied.reduce((sum, a) => sum + (a.application?.lots ?? 0), 0);
  const debited = applied.reduce((sum, a) => sum + (a.application?.amountDebited ?? 0), 0);
  const refundTotal = applied.reduce((sum, a) => sum + (a.application?.refundAmount ?? 0), 0);
  const settled = applied.some((a) => a.application?.allottedShares !== null);
  const error = (save.error ?? applyAll.error ?? refund.error) as Error | null;

  return (
    <Card style={{ padding: 16, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>Your application</Text>
        {board.amountPerLot !== null && (
          <Text style={{ color: t.textFaint, fontSize: 11.5 }}>{money(board.amountPerLot)} per lot</Text>
        )}
      </View>

      {applied.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            marginTop: 14,
            backgroundColor: t.surface2,
            borderRadius: 10,
            paddingVertical: 11,
            paddingHorizontal: 14,
          }}
        >
          <Stat label="Accounts" value={`${applied.length}/${board.accounts.length}`} />
          <Stat label="Lots" value={num(lots)} />
          <Stat label={settled ? 'Invested' : 'Blocked'} value={money(settled ? debited : blocked)} />
          {settled && <Stat label="Back" value={money(refundTotal)} />}
        </View>
      )}

      {applied.length === 0 && (
        <View style={{ marginTop: 14 }}>
          <Button
            title={`Applied 1 lot from all ${board.accounts.length}`}
            onPress={() => applyAll.mutate(1)}
            loading={applyAll.isPending}
          />
        </View>
      )}

      {error && (
        <View style={{ marginTop: 12 }}>
          <Banner tone="error">{error.message}</Banner>
        </View>
      )}

      {board.accounts.map((account, index) => {
        const app = account.application;
        const isSettled = app?.allottedShares !== null && app?.allottedShares !== undefined;

        return (
          <View
            key={account.panId}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 11,
              paddingVertical: 12,
              marginTop: index === 0 ? 12 : 0,
              borderTopWidth: 1,
              borderTopColor: t.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>
                {account.label}{' '}
                <Text style={{ color: t.textFaint, fontWeight: '400', fontSize: 12.5 }}>{account.panMasked}</Text>
              </Text>
              <Text style={{ color: t.textFaint, fontSize: 11.5, marginTop: 1 }}>
                {!app
                  ? 'Not applied'
                  : isSettled
                    ? app.allottedShares! > 0
                      ? `Allotted ${num(app.allottedShares)} · ${money(app.amountDebited)}`
                      : `Not allotted · ${money(app.refundAmount)} back`
                    : `${num(app.shares)} shares · ${money(app.amountBlocked)} blocked`}
              </Text>
            </View>

            {isSettled && app ? (
              <RefundControl
                status={app.refundStatus}
                busy={refund.isPending}
                theme={t}
                onToggle={(received) => refund.mutate({ id: app.id, received })}
              />
            ) : (
              <LotStepper
                lots={app?.lots ?? 0}
                theme={t}
                disabled={save.isPending}
                onChange={(next) => save.mutate({ panId: account.panId, lots: next })}
              />
            )}
          </View>
        );
      })}
    </Card>
  );
}

export { IconWallet };
