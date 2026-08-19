import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Section } from '../components/IpoCard';
import {
  IconAlert,
  IconBell,
  IconCalendar,
  IconCheck,
  IconClock,
  IconInfo,
  IconTarget,
  IconTrend,
} from '../components/Icons';
import { relativeTime } from '../format';
import { enableBrowserPush, pushPermission } from '../push';
import type { AlertPrefs } from '../types';

const KIND_ICON: Record<string, typeof IconBell> = {
  ipo_open: IconCalendar,
  ipo_closing: IconClock,
  allotment_out: IconBell,
  allotment_result: IconTarget,
  listing_day: IconTrend,
  gmp_move: IconTrend,
};

const TOGGLES: { key: keyof AlertPrefs; title: string; sub: string }[] = [
  { key: 'ipo_open', title: 'IPO opens', sub: 'When a new issue opens for applications' },
  { key: 'ipo_closing', title: 'Closing soon', sub: 'A day before, and on the last day' },
  { key: 'allotment_out', title: 'Allotment results', sub: 'The moment results go live, with your totals' },
  { key: 'listing_day', title: 'Listing day', sub: 'When an IPO you tracked lists' },
  { key: 'gmp_moves', title: 'GMP moves', sub: 'When the grey market premium shifts sharply' },
  { key: 'only_watchlist', title: 'Watchlist only', sub: 'Mute IPOs you have not starred' },
];

function PushSetup() {
  const [permission, setPermission] = useState(pushPermission());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setPermission(pushPermission()), []);

  if (permission === 'granted') {
    return (
      <div className="banner success">
        <IconCheck size={16} />
        <span>Browser notifications are on for this device.</span>
      </div>
    );
  }

  if (permission === 'unsupported') {
    return (
      <div className="banner warn">
        <IconInfo size={16} />
        <span>This browser cannot show push notifications. Use the mobile app for alerts.</span>
      </div>
    );
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 22 }}>
      <h3 style={{ margin: '0 0 5px', fontSize: 14.5, fontWeight: 600 }}>Turn on notifications</h3>
      <p className="dim" style={{ margin: '0 0 14px', fontSize: 13 }}>
        Get told when allotment is out and how many of your accounts got shares — without opening the site.
      </p>
      {error && (
        <div className="banner error">
          <IconAlert size={16} />
          <span>{error}</span>
        </div>
      )}
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await enableBrowserPush().catch((e: Error) => ({ ok: false, reason: e.message }));
          if (!res.ok) setError(res.reason ?? 'Could not enable notifications.');
          setPermission(pushPermission());
          setBusy(false);
        }}
      >
        {busy && <span className="spinner" />}
        Enable notifications
      </button>
    </div>
  );
}

export function Alerts() {
  const queryClient = useQueryClient();

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications,
    refetchInterval: 60_000,
  });
  const { data: prefs } = useQuery({ queryKey: ['prefs'], queryFn: api.prefs });

  const savePrefs = useMutation({
    mutationFn: (patch: Record<string, boolean | number>) => api.savePrefs(patch),
    onSuccess: (data) => queryClient.setQueryData(['prefs'], data),
  });

  const markRead = useMutation({
    mutationFn: () => api.markRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['unread'] });
    },
  });

  const unread = (notifications ?? []).filter((n) => !n.readAt).length;

  return (
    <div>
      <h1 className="page-title">Alerts</h1>
      <p className="page-sub">IPO events and allotment results, pushed to you.</p>

      <PushSetup />

      <Section
        title="Notifications"
        count={notifications?.length}
        action={
          unread > 0 ? (
            <button className="btn ghost sm" onClick={() => markRead.mutate()}>
              Mark all read
            </button>
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="skeleton" style={{ height: 160 }} />
        ) : (notifications ?? []).length === 0 ? (
          <div className="card empty">
            <IconBell size={26} />
            <div>Nothing yet. We will tell you when an IPO opens or allotment is out.</div>
          </div>
        ) : (
          <div className="card rows">
            {notifications!.map((n) => {
              const Icon = KIND_ICON[n.kind] ?? IconBell;
              return (
                <Link
                  key={n.id}
                  to={n.ipoId ? `/ipo/${n.ipoId}` : '/alerts'}
                  className="row"
                  style={{ background: n.readAt ? undefined : 'var(--accent-subtle)' }}
                >
                  <Icon size={17} className="dim" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row-title">{n.title}</div>
                    <div className="row-sub" style={{ whiteSpace: 'normal' }}>
                      {n.body}
                    </div>
                  </div>
                  <div className="faint" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                    {relativeTime(n.createdAt)}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Notification preferences">
        <div className="card rows">
          {TOGGLES.map((toggle) => {
            const on = Boolean(prefs?.[toggle.key]);
            return (
              <div className="row" key={toggle.key}>
                <div style={{ flex: 1 }}>
                  <div className="row-title">{toggle.title}</div>
                  <div className="row-sub" style={{ whiteSpace: 'normal' }}>
                    {toggle.sub}
                  </div>
                </div>
                <button
                  className={`switch ${on ? 'on' : ''}`}
                  aria-label={toggle.title}
                  onClick={() => savePrefs.mutate({ [toggle.key]: !on })}
                />
              </div>
            );
          })}

          <div className="row">
            <div style={{ flex: 1 }}>
              <div className="row-title">GMP alert threshold</div>
              <div className="row-sub">Notify when GMP moves more than this much</div>
            </div>
            <select
              className="input"
              style={{ width: 92 }}
              value={prefs?.gmp_threshold ?? 10}
              onChange={(e) => savePrefs.mutate({ gmp_threshold: Number(e.target.value) })}
            >
              {[5, 10, 20, 30, 50].map((v) => (
                <option key={v} value={v}>
                  {v}%
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>
    </div>
  );
}
