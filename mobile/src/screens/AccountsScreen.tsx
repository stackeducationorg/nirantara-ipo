import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Banner, Button, Card, Empty, makeStyles } from '../components';
import { shortDate } from '../format';
import { IconCheck, IconCopy, IconLogout, IconWallet } from '../icons';
import { useAuth } from '../auth';
import { api } from '../queries';
import { useTheme } from '../theme';

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function AccountsScreen() {
  const t = useTheme();
  const s = makeStyles(t);
  const queryClient = useQueryClient();
  const { account, logout } = useAuth();

  const [pan, setPan] = useState('');
  const [label, setLabel] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: pans, isLoading } = useQuery({ queryKey: ['pans'], queryFn: api.pans });
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pans'] });

  const add = useMutation({
    mutationFn: () => api.addPan({ pan: pan.toUpperCase(), label: label.trim() || 'Account' }),
    onSuccess: () => {
      setPan('');
      setLabel('');
      void invalidate();
    },
  });

  const remove = useMutation({ mutationFn: api.deletePan, onSuccess: invalidate });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.updatePan(id, { isActive }),
    onSuccess: invalidate,
  });

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

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Accounts</Text>
      <Text style={s.sub}>Every PAN saved here is checked on every IPO allotment, automatically.</Text>

      <Card style={{ padding: 16, marginBottom: 18 }}>
        <Text style={{ color: t.textDim, fontSize: 12, fontWeight: '600', marginBottom: 5 }}>PAN NUMBER</Text>
        <TextInput
          style={inputStyle}
          placeholder="ABCDE1234F"
          placeholderTextColor={t.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={10}
          value={pan}
          onChangeText={(v) => setPan(v.toUpperCase())}
        />

        <Text style={{ color: t.textDim, fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 5 }}>
          LABEL
        </Text>
        <TextInput
          style={inputStyle}
          placeholder="Self, Spouse, Father…"
          placeholderTextColor={t.textFaint}
          maxLength={40}
          value={label}
          onChangeText={setLabel}
        />

        {add.isError && <View style={{ marginTop: 12 }}><Banner tone="error">{(add.error as Error).message}</Banner></View>}

        <View style={{ marginTop: 14 }}>
          <Button
            title="Save PAN"
            onPress={() => add.mutate()}
            disabled={!PAN_RE.test(pan.toUpperCase())}
            loading={add.isPending}
          />
        </View>
        <Text style={{ color: t.textFaint, fontSize: 11.5, textAlign: 'center', marginTop: 10 }}>
          PANs are encrypted before being stored and are only ever sent to the official registrar.
        </Text>
      </Card>

      {isLoading ? null : (pans ?? []).length === 0 ? (
        <Empty icon={IconWallet} text="No PANs saved yet." />
      ) : (
        <Card>
          {pans!.map((p, index) => (
            <View
              key={p.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 11,
                padding: 13,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: t.border,
              }}
            >
              <Switch
                value={p.isActive}
                onValueChange={(v) => toggle.mutate({ id: p.id, isActive: v })}
                trackColor={{ true: t.accent, false: t.border }}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>{p.label}</Text>
                <Text style={{ color: t.textFaint, fontSize: 11.5 }}>
                  {p.pan}
                  {p.holderName ? ` · ${p.holderName}` : ''} · added {shortDate(p.createdAt.slice(0, 10))}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  Alert.alert('Remove PAN', `Remove ${p.label} (${p.pan})?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(p.id) },
                  ])
                }
              >
                <Text style={{ color: t.neg, fontWeight: '600', fontSize: 13 }}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <Card style={{ padding: 16, marginTop: 18 }}>
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>Sync with the website</Text>
        <Text style={{ color: t.textDim, fontSize: 13, marginTop: 4, marginBottom: 12 }}>
          Use this key to share the same PAN book across devices.
        </Text>

        <Pressable
          onPress={async () => {
            if (!me?.syncKey) return;
            await Clipboard.setStringAsync(me.syncKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          <View style={[inputStyle, { flexDirection: 'row', justifyContent: 'space-between' }]}>
            <Text style={{ color: t.text, fontWeight: '600', letterSpacing: 1 }}>{me?.syncKey ?? '—'}</Text>
            {copied ? <IconCheck size={16} color={t.accent} /> : <IconCopy size={16} color={t.accent} />}
          </View>
        </Pressable>
      </Card>

      <Card style={{ padding: 16, marginTop: 18 }}>
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>Signed in</Text>
        <Text style={{ color: t.textDim, fontSize: 13, marginTop: 4, marginBottom: 14 }}>
          {account?.email ?? ''}
        </Text>
        <Button title="Sign out" variant="danger" onPress={() => void logout()} />
      </Card>

      <View style={{ alignItems: 'center', marginTop: 26 }}>
        <Text style={{ color: t.textFaint, fontSize: 11.5, textAlign: 'center' }}>
          All rights reserved to Nirantara IPO © {new Date().getFullYear()}.{'\n'}
          Developed by stackeducation.in
        </Text>
      </View>
    </ScrollView>
  );
}
