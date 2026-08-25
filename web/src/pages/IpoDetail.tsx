import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useAuth } from '../auth';
import { useJsonLd, useSeo, SITE_ORIGIN } from '../seo';
import { AllotmentOdds } from '../components/AllotmentOdds';
import { AllotmentPanel } from '../components/AllotmentPanel';
import { Logo } from '../components/IpoCard';
import { IconArrowLeft } from '../components/Icons';
import { gmpText, gmpTone, money, relativeTime, shortDate, statusLabel } from '../format';
import type { Ipo } from '../types';

/** Search snippet for one issue. Front-loads the facts people actually search for. */
function ipoDescription(ipo: Ipo): string {
  const facts: string[] = [];
  if (ipo.priceText) facts.push(`price band ₹${ipo.priceText}`);
  if (ipo.lotSize) facts.push(`lot size ${ipo.lotSize}`);
  if (ipo.gmp !== null) facts.push(`GMP ${gmpText(ipo.gmp)}`);
  const detail = facts.length ? `${facts.join(', ')}. ` : '';
  return `${ipo.name} IPO — ${detail}Dates, subscription and allotment, checked across every saved PAN automatically.`;
}

/**
 * Stands in for the allotment panel when nobody is signed in. IPO detail pages are public so
 * they can be indexed, which means this is the first thing most search visitors will see.
 */
function AllotmentCta({ ipo }: { ipo: Ipo }) {
  return (
    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <h2 className="section-title" style={{ marginBottom: 8 }}>
        Check {ipo.name} allotment
      </h2>
      <p className="faint" style={{ fontSize: 13.5, lineHeight: 1.65, marginBottom: 14 }}>
        Save your PANs once and every one of them is checked the moment the registrar
        publishes — then you are told how many were allotted, without opening anything.
      </p>
      <Link to="/login?mode=signup" className="btn primary">
        Create a free account
      </Link>
    </div>
  );
}

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
  const { account } = useAuth();
  const { data: ipo, isLoading } = useQuery({ queryKey: ['ipo', id], queryFn: () => api.ipo(id) });

  // Both hooks run before the early returns below — hooks cannot be called conditionally. The
  // title is generic while the query is in flight and settles once the issue resolves.
  useSeo(
    ipo
      ? {
          title: `${ipo.name} IPO — GMP, Price Band & Allotment | Nirantara`,
          description: ipoDescription(ipo),
          path: `/ipo/${ipo.id}`,
          type: 'article',
        }
      : {
          title: 'IPO details | Nirantara IPO',
          description: 'Live GMP, price band, dates, subscription and allotment for this IPO.',
          path: `/ipo/${id}`,
        },
  );

  useJsonLd(
    ipo
      ? {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_ORIGIN },
            { '@type': 'ListItem', position: 2, name: 'Live GMP', item: `${SITE_ORIGIN}/gmp` },
            { '@type': 'ListItem', position: 3, name: `${ipo.name} IPO` },
          ],
        }
      : null,
  );

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

      <AllotmentOdds ipo={ipo} />
      {account ? <AllotmentPanel ipo={ipo} /> : <AllotmentCta ipo={ipo} />}
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
