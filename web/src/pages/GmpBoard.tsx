import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Logo } from '../components/IpoCard';
import { IconInfo, IconTrend } from '../components/Icons';
import { useSeo } from '../seo';
import { gmpPerLot, gmpText, gmpTone, money, relativeTime, signedMoney, statusLabel } from '../format';

type Filter = 'all' | 'IPO' | 'SME';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'IPO', label: 'Mainboard' },
  { key: 'SME', label: 'SME' },
];

export function GmpBoard() {
  const [filter, setFilter] = useState<Filter>('all');

  useSeo({
    title: 'Live IPO GMP Today — Grey Market Premium | Nirantara IPO',
    description:
      "Today's grey market premium for every open mainboard and SME IPO, highest first, with the expected gain per lot. Refreshed through the day from publicly reported figures.",
    path: '/gmp',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['gmp-board'],
    queryFn: api.gmpBoard,
    refetchInterval: 3 * 60_000,
  });

  const items = (data ?? []).filter((i) => filter === 'all' || i.category === filter);

  return (
    <div>
      <h1 className="page-title">Live GMP</h1>
      <p className="page-sub">Grey market premium, highest first.</p>

      <div className="chips">
        {FILTERS.map(({ key, label }) => (
          <button key={key} className={`chip ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="banner warn">
        <IconInfo size={16} />
        <span>
          GMP is an unofficial market signal based on public reports. It is not a prediction and not
          investment advice.
        </span>
      </div>

      {isLoading ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : items.length === 0 ? (
        <div className="card empty">
          <IconTrend size={26} />
          <div>No GMP data available right now.</div>
        </div>
      ) : (
        <div className="ipo-list">
          {items.map((ipo) => {
            const tone = gmpTone(ipo.gmp);
            const toneClass = tone === 'faint' ? 'faint' : tone === 'up' ? 'pos' : 'neg';
            // GMP is quoted per share; per lot is the figure someone applying actually needs.
            const perLot = gmpPerLot(ipo.gmp, ipo.lotSize);

            return (
              <Link key={ipo.id} to={`/ipo/${ipo.id}`} className="ipo-row">
                <Logo ipo={ipo} />
                <div className="ipo-main">
                  <div className="ipo-name">
                    {ipo.name}
                    {ipo.category === 'SME' && <span className="tag">SME</span>}
                  </div>
                  <div className="ipo-meta">
                    <span className={`tag ${ipo.status}`}>{statusLabel(ipo.status)}</span>
                    <span className="mono">₹{ipo.priceText}</span>
                    <span className="faint">·</span>
                    <span className="mono">{money(ipo.lotAmount)}/lot</span>
                  </div>
                </div>
                <div className="ipo-right">
                  <div className={`mono ${toneClass}`} style={{ fontSize: 15, fontWeight: 620 }}>
                    {gmpText(ipo.gmp)}
                  </div>
                  {perLot !== null && perLot !== 0 && (
                    <div className={`mono ${toneClass}`} style={{ fontSize: 12.5, fontWeight: 560 }}>
                      {signedMoney(perLot)}/lot
                    </div>
                  )}
                  <div className="ipo-right-sub mono">
                    {[
                      ipo.gmp !== 0 && ipo.gmpPercent !== null ? `${ipo.gmpPercent}%` : null,
                      ipo.gmpUpdatedAt ? relativeTime(ipo.gmpUpdatedAt) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
