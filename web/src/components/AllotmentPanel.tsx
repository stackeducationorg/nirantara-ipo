import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError, type CaptchaChallenge } from '../api';
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

/**
 * Only the two outcomes that are actually *about* this application get colour. "No application
 * found" stays neutral — it is not a bad result, it just means that account did not apply, and
 * coding it red would make an ordinary row look like a failure.
 */
const STATUS_TONE: Record<AllotmentResult['status'], string> = {
  allotted: 'pos',
  not_allotted: 'neg',
  not_applied: '',
  pending: '',
  error: 'neg',
};

/** Allotted first, then the applications that missed out; the rest sink to the bottom. */
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

function ResultRow({ result }: { result: AllotmentResult }) {
  return (
    <div className="row">
      <span className={`status-dot status-${result.status}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* The registrar's name is what identifies the applicant; the label is usually a
            generic "Account" the user never customised, so it takes the secondary line. */}
        <div className="row-title">
          {result.nameOnRecord ?? result.label}
          <span className="faint mono" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12.5 }}>
            {result.panMasked}
          </span>
        </div>
        <div className="row-sub">
          {result.nameOnRecord ? `${result.label} · ` : ''}
          <span className={STATUS_TONE[result.status]} style={{ fontWeight: STATUS_TONE[result.status] ? 560 : undefined }}>
            {STATUS_TEXT[result.status]}
          </span>
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

  /**
   * Some registrars (Bigshare) will not answer without a captcha a human has read. The
   * server returns 428 with the challenge attached; it is shown here and the answer is sent
   * back with a retry. A captcha is spent on one lookup, so the retry names a single PAN.
   */
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [answer, setAnswer] = useState('');
  const [panForCaptcha, setPanForCaptcha] = useState('');

  const check = useMutation({
    mutationFn: (opts?: { panId?: string; captchaToken?: string; captchaAnswer?: string }) =>
      api.checkAllotment(ipo.id, opts),
    onSuccess: (data) => {
      setCaptcha(null);
      setAnswer('');
      queryClient.setQueryData(['allotment', ipo.id], data);
      void queryClient.invalidateQueries({ queryKey: ['allotment-history'] });
      void queryClient.invalidateQueries({ queryKey: ['pans'] });
    },
    onError: (err) => {
      const body = err instanceof ApiError ? (err.body as { captcha?: CaptchaChallenge } | null) : null;
      // A wrong answer comes back as another 428 with a *new* image — the spent one cannot
      // be retried, so the prompt simply refreshes rather than closing.
      if (body?.captcha) {
        setCaptcha(body.captcha);
        setAnswer('');
        if (!panForCaptcha && activePansForCaptcha[0]) setPanForCaptcha(activePansForCaptcha[0].id);
      }
    },
  });

  const activePansForCaptcha = (pans ?? []).filter((p) => p.isActive);

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

      {hasResults && (
        <div className="rows" style={{ marginTop: 4 }}>
          {[...results].sort(byOutcome).map((r) => (
            <ResultRow key={r.panId} result={r} />
          ))}
        </div>
      )}

      {check.isError && (
        <div style={{ padding: '14px 16px 0' }}>
          <div className="banner error" style={{ marginBottom: 0 }}>
            <IconAlert size={16} />
            <span>{(check.error as ApiError).message}</span>
          </div>
        </div>
      )}

      {captcha && (
        <div style={{ padding: '0 16px 4px' }}>
          <div className="card card-pad" style={{ background: 'var(--surface-2)' }}>
            <div className="section-title" style={{ marginBottom: 6 }}>
              This registrar needs a captcha
            </div>
            <p className="dim" style={{ margin: '0 0 12px', fontSize: 13 }}>
              Bigshare asks for a code before it will answer. One code covers one account, so
              pick which to check and type what you see.
            </p>

            <div className="field">
              <label className="label" htmlFor="captcha-pan">
                Account
              </label>
              <select
                id="captcha-pan"
                className="input"
                value={panForCaptcha}
                onChange={(e) => setPanForCaptcha(e.target.value)}
              >
                {activePansForCaptcha.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.holderName ?? p.label} — {p.pan ?? p.demat}
                  </option>
                ))}
              </select>
            </div>

            <img
              src={captcha.image}
              alt="Captcha from the registrar"
              style={{
                display: 'block',
                marginBottom: 10,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: '#fff',
                maxWidth: '100%',
              }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input mono"
                placeholder="Type the code"
                value={answer}
                autoComplete="off"
                autoCapitalize="characters"
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && answer.trim()) {
                    check.mutate({ panId: panForCaptcha, captchaToken: captcha.token, captchaAnswer: answer.trim() });
                  }
                }}
                style={{ flex: 1, textTransform: 'uppercase' }}
              />
              <button
                className="btn primary"
                disabled={!answer.trim() || !panForCaptcha || check.isPending}
                onClick={() =>
                  check.mutate({ panId: panForCaptcha, captchaToken: captcha.token, captchaAnswer: answer.trim() })
                }
              >
                {check.isPending && <span className="spinner" />}
                Submit
              </button>
              <button className="btn" onClick={() => setCaptcha(null)} disabled={check.isPending}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: 16 }}>
        <button
          className="btn primary block"
          disabled={check.isPending || beforeAllotment}
          onClick={() => check.mutate(undefined)}
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
