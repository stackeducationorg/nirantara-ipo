import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Logo, Section } from '../components/IpoCard';
import { REFUND_LABEL } from '../components/ApplyPanel';
import { IconInfo, IconWallet } from '../components/Icons';
import { money, num, shortDate } from '../format';
import type { RefundStatus } from '../types';

const TONE_CLASS: Record<RefundStatus, string> = {
  blocked: '',
  refund_pending: 'allotment',
  refund_received: 'open',
  debited: 'open',
};

export function Money() {
  const { data: summary, isLoading } = useQuery({
    queryKey: ['money-summary'],
    queryFn: api.moneySummary,
  });
  const { data: rows } = useQuery({ queryKey: ['money-by-ipo'], queryFn: api.moneyByIpo });

  const hasAny = (summary?.applicationCount ?? 0) > 0;

  return (
    <div>
      <h1 className="page-title">Money</h1>
      <p className="page-sub">
        What you applied for from each account, and where that money is right now.
      </p>

      {isLoading ? (
        <div className="skeleton" style={{ height: 120, marginBottom: 22 }} />
      ) : !hasAny ? (
        <div className="card empty">
          <IconWallet size={26} />
          <div style={{ marginBottom: 6 }}>Nothing recorded yet.</div>
          <div className="faint" style={{ fontSize: 12.5, maxWidth: 320, margin: '0 auto 16px' }}>
            Open an IPO and mark how many lots you applied for from each account — the totals and
            refunds will show up here.
          </div>
          <Link to="/" className="btn primary">
            Browse IPOs
          </Link>
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
                <Link key={row.ipoId} to={`/ipo/${row.ipoId}`} className="ipo-row">
                  <Logo ipo={{ name: row.ipoName, logoUrl: row.logoUrl }} />
                  <div className="ipo-main">
                    <div className="ipo-name">
                      {row.ipoName}
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
                  </div>
                </Link>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
