import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { money, num, relativeTime, shortDate } from '../format';
import type { AllotmentResult, AllotmentSummary, Ipo } from '../types';
import { IconAlert, IconClock } from './Icons';

const STATUS_TEXT: Record<AllotmentResult['status'], string> = {
  allotted: 'Allotted',
  not_allotted: 'Not allotted',
  not_applied: 'No application found',
  pending: 'Awaiting results',
  error: 'Check failed',
};

function ResultRow({ result }: { result: AllotmentResult }) {
  return (
    <div className="row">
      <span className={`status-dot status-${result.status}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row-title">
          {result.label}
          <span className="faint mono" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12.5 }}>
            {result.panMasked}
          </span>
        </div>
        <div className="row-sub">
          {result.nameOnRecord ? `${result.nameOnRecord} · ` : ''}
          {STATUS_TEXT[result.status]}
          {result.status === 'error' && result.message ? ` — ${result.message}` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {result.status === 'allotted' ? (
          <>
            <div className="mono pos" style={{ fontWeight: 620 }}>
              {num(result.allottedQty)}
            </div>
            <div className="row-sub mono">{money(result.amount)}</div>
          </>
        ) : (
          <div className="faint mono" style={{ fontSize: 12.5 }}>
            {result.appliedQty ? `applied ${num(result.appliedQty)}` : '—'}
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ summary }: { summary: AllotmentSummary }) {
  const won = summary.allottedAccounts > 0;

  return (
    <div className="result-summary">
      <div className={`result-figure ${won ? 'pos' : ''}`}>
        {summary.allottedAccounts}
        <span className="faint" style={{ fontSize: 22, fontWeight: 500 }}> / {summary.totalAccounts}</span>
      </div>
      <div className="result-caption">
        {won ? 'accounts allotted' : 'accounts allotted — nothing this time'}
      </div>

      {won && (
        <div className="result-money">
          <div>
            <div className="stat-label">Shares</div>
            <div className="stat-value mono">{num(summary.totalShares)}</div>
          </div>
          <div>
            <div className="stat-label">Value at cut-off</div>
            <div className="stat-value mono">{money(summary.totalAmount)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AllotmentPanel({ ipo }: { ipo: Ipo }) {
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
      void queryClient.invalidateQueries({ queryKey: ['pans'] });
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const beforeAllotment = Boolean(ipo.boaDate && today < ipo.boaDate);
  const activePans = (pans ?? []).filter((p) => p.isActive);

  if (activePans.length === 0) {
    return (
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2 className="section-title" style={{ marginBottom: 8 }}>
          Allotment
        </h2>
        <p className="dim" style={{ margin: '0 0 14px', fontSize: 13.5 }}>
          Save your PANs once and every future IPO is checked across all of them automatically.
        </p>
        <Link to="/accounts" className="btn primary block">
          Add a PAN
        </Link>
      </div>
    );
  }

  const results = summary?.results ?? [];
  const hasResults = Boolean(summary?.checked && results.length > 0);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          padding: '16px 16px 0',
        }}
      >
        <h2 className="section-title">Allotment</h2>
        {summary?.registrar && (
          <span className="faint" style={{ fontSize: 12, textTransform: 'capitalize' }}>
            via {summary.registrar}
          </span>
        )}
      </div>

      {hasResults && summary!.resultsLive && <Summary summary={summary!} />}

      {beforeAllotment && (
        <div style={{ padding: '14px 16px 0' }}>
          <div className="banner info" style={{ marginBottom: 0 }}>
            <IconClock size={16} />
            <span>
              Allotment is expected on <strong>{shortDate(ipo.boaDate)}</strong>. We check it automatically
              the moment results go live and notify you.
            </span>
          </div>
        </div>
      )}

      {hasResults && <div className="rows" style={{ marginTop: 4 }}>{results.map((r) => <ResultRow key={r.panId} result={r} />)}</div>}

      {check.isError && (
        <div style={{ padding: '14px 16px 0' }}>
          <div className="banner error" style={{ marginBottom: 0 }}>
            <IconAlert size={16} />
            <span>{(check.error as ApiError).message}</span>
          </div>
        </div>
      )}

      <div style={{ padding: 16 }}>
        <button
          className="btn primary block"
          disabled={check.isPending || beforeAllotment}
          onClick={() => check.mutate()}
        >
          {check.isPending && <span className="spinner" />}
          {check.isPending
            ? `Checking ${activePans.length} account${activePans.length > 1 ? 's' : ''}…`
            : beforeAllotment
              ? `Auto-check scheduled for ${shortDate(ipo.boaDate)}`
              : `Check all ${activePans.length} account${activePans.length > 1 ? 's' : ''} now`}
        </button>

        {hasResults && (
          <div className="faint" style={{ fontSize: 12, textAlign: 'center', marginTop: 10 }}>
            Last checked {relativeTime(results[0]?.checkedAt)}
          </div>
        )}
      </div>
    </div>
  );
}
