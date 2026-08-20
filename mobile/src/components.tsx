import { ReactNode, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { API_BASE } from './api';
import { gmpText, gmpTone, initials, money, shortDate, statusLabel } from './format';
import { statusColor, useTheme, type Theme } from './theme';
import type { Ipo } from './types';

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return (
    <View style={[{ backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: 14 }, style]}>
      {children}
    </View>
  );
}

export function Pill({ label, status }: { label: string; status?: string }) {
  const t = useTheme();
  const c = status ? statusColor(t, status) : { bg: t.surface2, fg: t.textDim };
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ color: c.fg, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'plain' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.accent : t.surface;
  const fg = variant === 'primary' ? '#fff' : variant === 'danger' ? t.neg : t.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: bg,
        borderColor: variant === 'primary' ? t.accent : t.border,
        borderWidth: 1,
        borderRadius: 11,
        paddingVertical: 12,
        alignItems: 'center',
        opacity: disabled || loading ? 0.55 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontWeight: '600', fontSize: 14.5 }}>{title}</Text>
      )}
    </Pressable>
  );
}

/**
 * Same layering trick as the web build: initials render underneath, so a logo that fails or is
 * still loading never leaves an empty square.
 */
export function Logo({ ipo, size = 38 }: { ipo: Pick<Ipo, 'name' | 'logoUrl'>; size?: number }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const uri = ipo.logoUrl ? `${API_BASE}/media/logo?u=${encodeURIComponent(ipo.logoUrl)}` : null;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        backgroundColor: t.surface2,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontWeight: '800', fontSize: size * 0.34, color: t.textDim }}>{initials(ipo.name)}</Text>
      {uri && !failed && (
        <Image
          source={{ uri }}
          onError={() => setFailed(true)}
          resizeMode="contain"
          style={{ position: 'absolute', width: size, height: size, backgroundColor: '#fff', padding: 3 }}
        />
      )}
    </View>
  );
}

export function IpoRow({ ipo, onPress }: { ipo: Ipo; onPress: () => void }) {
  const t = useTheme();
  const tone = gmpTone(ipo.gmp);
  const toneColor = tone === 'up' ? t.pos : tone === 'down' ? t.neg : t.textFaint;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <Card style={{ padding: 13, marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
          <Logo ipo={ipo} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: t.text, fontWeight: '600', fontSize: 14.5 }} numberOfLines={2}>
              {ipo.name}
            </Text>
            <View style={{ flexDirection: 'row', gap: 5, marginTop: 5 }}>
              <Pill label={statusLabel(ipo.status)} status={ipo.status} />
              {ipo.category === 'SME' && <Pill label="SME" />}
            </View>
          </View>
          {ipo.gmp !== null && (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: toneColor, fontWeight: '700', fontSize: 16 }}>{gmpText(ipo.gmp)}</Text>
              <Text style={{ color: t.textFaint, fontSize: 10, fontWeight: '600' }}>
                GMP {ipo.gmp !== 0 && ipo.gmpPercent !== null ? `${ipo.gmpPercent}%` : ''}
              </Text>
            </View>
          )}
        </View>

        <View style={[styles.statsRow, { borderTopColor: t.border }]}>
          <Stat label="Price" value={ipo.priceText ? `₹${ipo.priceText}` : '—'} />
          <Stat label="Lot cost" value={money(ipo.lotAmount)} />
          <Stat
            label={ipo.status === 'upcoming' ? 'Opens' : 'Allotment'}
            value={shortDate(ipo.status === 'upcoming' ? ipo.openDate : ipo.boaDate)}
          />
        </View>
      </Card>
    </Pressable>
  );
}

export function Stat({
  label,
  value,
  style,
}: {
  label: string;
  value: string;
  /** Overrides the default flex sizing. Pass a width to lay stats out in a wrapped grid instead. */
  style?: object;
}) {
  const t = useTheme();
  return (
    <View style={style ?? { flex: 1 }}>
      <Text style={{ color: t.textFaint, fontSize: 10, fontWeight: '600', textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text style={{ color: t.text, fontSize: 13.5, fontWeight: '600', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

type IconComponent = (props: { size?: number; color: string }) => JSX.Element;

export function Empty({ icon: Icon, text }: { icon: IconComponent; text: string }) {
  const t = useTheme();
  return (
    <Card style={{ padding: 36, alignItems: 'center' }}>
      <Icon size={26} color={t.textFaint} />
      <Text style={{ color: t.textFaint, textAlign: 'center', marginTop: 10, fontSize: 13.5 }}>{text}</Text>
    </Card>
  );
}

export function Banner({ tone, children }: { tone: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const t = useTheme();
  const map = {
    info: { bg: t.accentSubtle, fg: t.accent },
    warn: { bg: t.warnSubtle, fg: t.warn },
    error: { bg: t.negSubtle, fg: t.neg },
    success: { bg: t.posSubtle, fg: t.pos },
  }[tone];

  return (
    <View style={{ backgroundColor: map.bg, borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <Text style={{ color: map.fg, fontSize: 13.5, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
      <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>{title}</Text>
      {right && <Text style={{ color: t.textFaint, fontSize: 12.5 }}>{right}</Text>}
    </View>
  );
}

export const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: 16, paddingBottom: 40 },
    title: { color: t.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.6 },
    sub: { color: t.textDim, fontSize: 13.5, marginTop: 3, marginBottom: 18 },
  });

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 11,
    marginTop: 12,
    borderTopWidth: 1,
  },
});
