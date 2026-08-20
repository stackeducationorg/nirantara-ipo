import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ApplyPanel, REFUND_LABEL } from '../components/ApplyPanel';
import { Logo, Section } from '../components/IpoCard';
import { IconInfo, IconWallet } from '../components/Icons';
import { money, num, shortDate } from '../format';
import type { Ipo, RefundStatus } from '../types';

const TONE_CLASS: Record<RefundStatus, string> = {
  blocked: '',
  refund_pending: 'allotment',
  refund_received: 'open',
  debited: 'open',
};

export function Money() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');

  const { data: summary, isLoading } = useQuery({
    queryKey: ['money-summary'],
    queryFn: api.moneySummary,
  });
  const { data: rows } = useQuery({ queryKey: ['money-by-ipo'], queryFn: api.moneyByIpo });
  const { data: dashboard } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });

  /** The issues worth recording against: still open, coming up, or awaiting their result. */
  const selectable: Ipo[] = useMemo(() => {
    if (!dashboard) return [];
    return [...dashboard.open, ...dashboard.awaitingAllotment, ...dashboard.upcoming];
  }, [dashboard]);

  const selected = selectable.find((i) => i.id === selectedId) ?? null;

  const refundIpo = useMutation({
    mutationFn: (ipoId: string) => api.markIpoRefund(ipoId, true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['money-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['money-by-ipo'] });
      void queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });

  const hasAny = (summary?.applicationCount ?? 0) > 0;

  return (
    <div>
      <h1 className="page-title">Money</h1>
      <p className="page-sub">
        What you applied for from each account, and where that money is right now.
      </p>

      {/* Recording an application lives here rather than on the IPO page, so everything to do
          with money is in one place. */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <h2 className="section-title" style={{ marginBottom: 10 }}>
          Record an application
        </h2>
        <div className="field" style={{ marginBottom: selected ? 14 : 0 }}>
          <label className="label" htmlFor="ipo-pick">
            Choose an IPO
          </label>
          <select
            id="ipo-pick"
            className="input"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">Select an IPO…</option>
            {selectable.map((ipo) => (
              <option key={ipo.id} value={ipo.id}>
                {ipo.name}
                {ipo.category === 'SME' ? ' (SME)' : ''}
              </option>
            ))}
          </select>
          {selectable.length === 0 && (
            <p className="input-hint">No IPOs are open or awaiting allotment right now.</p>
          )}
        </div>
      </div>

      {selected && <ApplyPanel ipo={selected} />}

      {isLoading ? (
        <div className="skeleton" style={{ height: 120, marginBottom: 22 }} />
      ) : !hasAny ? (
        <div className="card empty">
          <IconWallet size={26} />
          <div style={{ marginBottom: 6 }}>Nothing recorded yet.</div>
          <div className="faint" style={{ fontSize: 12.5, maxWidth: 340, margin: '0 auto' }}>
            Pick an IPO above and mark how many lots you applied for from each account — the
            totals and refunds will show up here.
          </div>
        </div>
      ) : (
        <>
          <div className="stat-grid" style={{ marginBottom: 22 }}>
            <div className="stat">
              <div className="stat-label">Currently blocked</div>
              <div className="stat-value mono" style={{ fontSize: 19 }}>
                {money(summary!.totalBlocked)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Refund due</div>
              {/* Colour only carries meaning when there is actually something owed. */}
              <div
                className="stat-value mono"
                style={{ fontSize: 19, color: summary!.refundPending > 0 ? 'var(--warn)' : undefined }}
              >
                {money(summary!.refundPending)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Refunded</div>
              <div className="stat-value mono" style={{ fontSize: 19 }}>
                {money(summary!.refundReceived)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Invested</div>
              <div className={`stat-value mono ${summary!.totalInvested > 0 ? 'pos' : ''}`} style={{ fontSize: 19 }}>
                {money(summary!.totalInvested)}
              </div>
            </div>
          </div>

          {summary!.refundPending > 0 && (
            <div className="banner warn">
              <IconInfo size={16} />
              <span>
                <strong>{money(summary!.refundPending)}</strong> is owed back from issues where you were
                not allotted. Mark each one refunded once it lands in your bank.
              </span>
            </div>
          )}

          <Section title="By IPO" count={rows?.length}>
            <div className="ipo-list">
              {(rows ?? []).map((row) => (
                <div className="ipo-row" key={row.ipoId}>
                  <Logo ipo={{ name: row.ipoName, logoUrl: row.logoUrl }} />
                  <div className="ipo-main">
                    <div className="ipo-name">
                      <Link to={`/ipo/${row.ipoId}`}>{row.ipoName}</Link>
                      <span className={`tag ${TONE_CLASS[row.refundStatus]}`}>
                        {REFUND_LABEL[row.refundStatus]}
                      </span>
                    </div>
                    <div className="ipo-meta">
                      <span className="mono">{row.accounts}</span> account
                      {row.accounts === 1 ? '' : 's'}
                      <span className="faint">·</span>
                      <span className="mono">{num(row.totalLots)}</span> lots
                      {row.boaDate && (
                        <>
                          <span className="faint">·</span>
                          <span>{shortDate(row.boaDate)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="ipo-right">
                    <div className="mono" style={{ fontWeight: 560 }}>
                      {money(row.amountBlocked)}
                    </div>
                    <div className="ipo-right-sub mono">
                      {row.allottedShares > 0
                        ? `${num(row.allottedShares)} sh · ${money(row.amountDebited)} invested`
                        : row.refundAmount > 0
                          ? `${money(row.refundAmount)} back`
                          : 'awaiting allotment'}
                    </div>
                    {/* One credit covers every application to an issue, so this settles them together. */}
                    {row.refundStatus === 'refund_pending' && (
                      <button
                        className="btn sm"
                        style={{ marginTop: 6 }}
                        disabled={refundIpo.isPending}
                        onClick={() => refundIpo.mutate(row.ipoId)}
                      >
                        {refundIpo.isPending && <span className="spinner" />}
                        Got it back
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
