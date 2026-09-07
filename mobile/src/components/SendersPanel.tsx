import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { Banner, Button, Card, Empty, SectionTitle, Stat } from '../components';
import { money, relativeTime } from '../format';
import { IconCheck, IconTrash, IconUser } from '../icons';
import { api } from '../queries';
import { useTheme } from '../theme';
import type { OneTimeSender } from '../types';

/**
 * The one-time side of the money page.
 *
 * Someone who sends the amount for a single application is not running a PAN book across ten
 * issues, so asking them to pick lots, an IPO and an account is all friction for a record
 * that only ever answers one question: has their money gone back yet? Hence a name, an
 * amount, and one button.
 */
export function SendersPanel() {
  const t = useTheme();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['senders'], queryFn: api.senders });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['senders'] });

  const add = useMutation({
    // Amounts are typed with the keypad, so digits and one dot are all that can arrive.
    mutationFn: () => api.addSender({ name: name.trim(), amount: Number(amount) || 0 }),
    onSuccess: () => {
      setName('');
      setAmount('');
      void invalidate();
    },
  });
  const mark = useMutation({
    mutationFn: ({ id, returned }: { id: string; returned: boolean }) => api.markSenderReturned(id, returned),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: api.deleteSender, onSuccess: invalidate });

  const inputStyle = {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.bg,
    color: t.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  };

  const canAdd = name.trim() !== '' && Number(amount) > 0;
  const error = (add.error ?? mark.error ?? remove.error) as Error | null;
  const summary = data?.summary;
  const senders = data?.senders ?? [];

  const confirmRemove = (sender: OneTimeSender) =>
    Alert.alert(
      `Remove ${sender.name}?`,
      'This deletes the entry entirely. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(sender.id) },
      ],
    );

  return (
    <>
      <Card style={{ padding: 16, marginBottom: 18 }}>
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 14, marginBottom: 10 }}>
          Add a one-time sender
        </Text>

        <Text style={{ color: t.textDim, fontSize: 12, fontWeight: '600', marginBottom: 5 }}>NAME</Text>
        <TextInput
          style={inputStyle}
          placeholder="Who sent the money"
          placeholderTextColor={t.textFaint}
          autoCapitalize="words"
          maxLength={60}
          value={name}
          onChangeText={setName}
        />

        <Text style={{ color: t.textDim, fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 5 }}>
          AMOUNT SENT
        </Text>
        <TextInput
          style={inputStyle}
          placeholder="14750"
          placeholderTextColor={t.textFaint}
          keyboardType="numeric"
          maxLength={12}
          value={amount}
          onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))}
        />

        <View style={{ marginTop: 14 }}>
          <Button
            title="Add sender"
            onPress={() => add.mutate()}
            disabled={!canAdd}
            loading={add.isPending}
          />
        </View>

        {error && (
          <View style={{ marginTop: 12 }}>
            <Banner tone="error">{error.message}</Banner>
          </View>
        )}
      </Card>

      {isLoading ? null : senders.length === 0 ? (
        <Empty
          icon={IconUser}
          text="No one-time senders yet. Add a name and the amount they sent, then mark it once the money goes back."
        />
      ) : (
        <>
          <Card style={{ padding: 16, marginBottom: 20 }}>
            <View style={{ flexDirection: 'row' }}>
              <Stat label="With me" value={money(summary?.holding ?? 0)} />
              <Stat label="Returned" value={money(summary?.returned ?? 0)} />
            </View>
          </Card>

          <SectionTitle title="Senders" right={`${summary?.holdingCount ?? 0} pending`} />
          <Card>
            {senders.map((sender, index) => {
              const held = sender.status === 'holding';
              return (
                <View
                  key={sender.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 11,
                    padding: 13,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: t.border,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                      {sender.name}
                    </Text>
                    <Text style={{ color: t.textFaint, fontSize: 11.5, marginTop: 3 }}>
                      {money(sender.amount)}
                      {held
                        ? ` · sent ${relativeTime(sender.receivedAt)}`
                        : ` · returned ${relativeTime(sender.returnedAt)}`}
                    </Text>
                  </View>

                  {held ? (
                    <Pressable
                      onPress={() => mark.mutate({ id: sender.id, returned: true })}
                      disabled={mark.isPending}
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 12,
                        borderRadius: 8,
                        backgroundColor: t.posSubtle,
                      }}
                    >
                      <Text style={{ color: t.pos, fontSize: 11.5, fontWeight: '700' }}>Got it back</Text>
                    </Pressable>
                  ) : (
                    // Tappable to undo: marking the wrong row is the only mistake possible here.
                    <Pressable
                      onPress={() => mark.mutate({ id: sender.id, returned: false })}
                      disabled={mark.isPending}
                      hitSlop={8}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
                    >
                      <IconCheck size={14} color={t.pos} />
                      <Text style={{ color: t.pos, fontSize: 12.5, fontWeight: '600' }}>Returned</Text>
                    </Pressable>
                  )}

                  <Pressable onPress={() => confirmRemove(sender)} hitSlop={8} disabled={remove.isPending}>
                    <IconTrash size={15} color={t.textFaint} />
                  </Pressable>
                </View>
              );
            })}
          </Card>
        </>
      )}
    </>
  );
}
