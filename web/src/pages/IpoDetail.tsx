import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { AllotmentPanel } from '../components/AllotmentPanel';
import { Logo } from '../components/IpoCard';
import { IconArrowLeft } from '../components/Icons';
import { gmpText, gmpTone, money, relativeTime, shortDate, statusLabel } from '../format';
import type { Ipo } from '../types';

function Timeline({ ipo }: { ipo: Ipo }) {
  const today = new Date().toISOString().slice(0, 10);
  const steps = [
    { label: 'Opens', date: ipo.openDate },
    { label: 'Closes', date: ipo.closeDate },
    { label: 'Allotment', date: ipo.boaDate },
    { label: 'Lists', date: ipo.listingDate },
  ].filter((s) => s.date);

  return (
    <div>
      {steps.map((step) => {
        const done = step.date! < today;
        const now = step.date === today;
        return (
          <div className="timeline-item" key={step.label}>
            <div className={`dot ${done ? 'done' : now ? 'now' : ''}`} />
            <div>
              <div className="row-title">{step.label}</div>
              <div className="row-sub">
                {shortDate(step.date)}
                {now && <span className="pos"> · today</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GmpChart({ ipo }: { ipo: Ipo }) {
  const history = ipo.gmpHistory ?? [];
  if (history.length < 2) return null;

  const data = history.map((point) => ({
    time: new Date(`${point.captured_at.replace(' ', 'T')}Z`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    }),
    gmp: point.gmp,
  }));

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="section-head">
        <h2 className="section-title">GMP trend</h2>
        <span className="section-count">{history.length} samples</span>
      </div>
      <ResponsiveContainer width="100%" height={168}>
        <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="gmpFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="time" tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickLine={false} axisLine={false} width={42} />
          <Tooltip
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--text)',
            }}
            formatter={(value: number) => [`₹${value}`, 'GMP']}
          />
          <Area type="monotone" dataKey="gmp" stroke="var(--accent)" strokeWidth={2} fill="url(#gmpFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Subscription({ ipo }: { ipo: Ipo }) {
  const sub = ipo.subscription;
  if (!sub) return null;

  const rows: [string, string][] = (
    [
      ['QIB', sub.qib ?? null],
      ['NII', sub.nii ?? null],
      ['bHNI', sub.bhni ?? null],
      ['sHNI', sub.shni ?? null],
      ['Retail', sub.rii ?? null],
      ['Total', sub.total ?? null],
    ] as [string, string | null][]
  ).flatMap(([label, value]) => (value && value !== '-' ? [[label, value] as [string, string]] : []));

  if (rows.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ padding: '16px 16px 8px' }}>
        <h2 className="section-title">Subscription</h2>
      </div>
      <div className="rows">
        {rows.map(([label, value]) => {
          // Upstream packs an "as of" stamp into the Total cell; show it as a caption.
          const [figure, ...rest] = value.split('|').map((part) => part.trim());
          const asOf = rest.join(' ');
          return (
            <div className="row" key={label}>
              <div style={{ flex: 1, fontWeight: label === 'Total' ? 620 : 500 }}>{label}</div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontWeight: 560 }}>
                  {figure}x
                </div>
                {asOf && <div className="row-sub">{asOf}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function IpoDetail() {
  const { id = '' } = useParams();
  const { data: ipo, isLoading } = useQuery({ queryKey: ['ipo', id], queryFn: () => api.ipo(id) });

  if (isLoading) return <div className="skeleton" style={{ height: 300 }} />;
  if (!ipo) return <div className="card empty">IPO not found.</div>;

  const tone = gmpTone(ipo.gmp);
  const toneClass = tone === 'faint' ? 'faint' : tone === 'up' ? 'pos' : 'neg';

  return (
    <div>
      <Link to="/" className="btn ghost sm" style={{ marginBottom: 16 }}>
        <IconArrowLeft size={14} /> Back
      </Link>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
          <Logo ipo={ipo} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 640, letterSpacing: '-0.025em' }}>{ipo.name}</div>
            <div className="ipo-meta" style={{ marginTop: 6 }}>
              <span className={`tag ${ipo.status}`}>{statusLabel(ipo.status)}</span>
              {ipo.category === 'SME' && <span className="tag">SME</span>}
              {ipo.exchange && <span className="tag">{ipo.exchange}</span>}
            </div>
          </div>
          {ipo.gmp !== null && (
            <div style={{ textAlign: 'right' }}>
              <div className={`mono ${toneClass}`} style={{ fontSize: 21, fontWeight: 680 }}>
                {gmpText(ipo.gmp)}
              </div>
              <div className="stat-label">
                GMP {ipo.gmp !== 0 && ipo.gmpPercent !== null ? `· ${ipo.gmpPercent}%` : ''}
              </div>
            </div>
          )}
        </div>

        <div className="stat-grid" style={{ marginTop: 18 }}>
          <div className="stat">
            <div className="stat-label">Price band</div>
            <div className="stat-value mono">{ipo.priceText ? `₹${ipo.priceText}` : '—'}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Lot size</div>
            <div className="stat-value mono">{ipo.lotSize ?? '—'}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Min investment</div>
            <div className="stat-value mono">{money(ipo.lotAmount)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Issue size</div>
            <div className="stat-value mono">{ipo.issueSize ?? '—'}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Est. listing</div>
            <div className="stat-value mono">{money(ipo.estListingPrice)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Registrar</div>
            <div className="stat-value" style={{ textTransform: 'capitalize' }}>
              {ipo.registrar ?? 'TBD'}
            </div>
          </div>
        </div>

        {ipo.gmpUpdatedAt && (
          <div className="faint" style={{ fontSize: 11.5, marginTop: 12 }}>
            GMP updated {relativeTime(ipo.gmpUpdatedAt)}
          </div>
        )}
      </div>

      <AllotmentPanel ipo={ipo} />
      <GmpChart ipo={ipo} />
      <Subscription ipo={ipo} />

      <div className="card card-pad">
        <h2 className="section-title" style={{ marginBottom: 16 }}>
          Timeline
        </h2>
        <Timeline ipo={ipo} />
      </div>
    </div>
  );
}
