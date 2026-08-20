import { useState } from 'react';
import { Link } from 'react-router-dom';
import { logoSrc } from '../api';
import { gmpText, gmpTone, initials, money, shortDate, statusLabel } from '../format';
import type { Ipo } from '../types';
import { IconInbox } from './Icons';

/**
 * The initials tile is always rendered and the logo layers on top, so a logo that 404s, hangs,
 * or is blocked simply reveals the initials. Logos are proxied because the upstream CDN
 * refuses hotlinked requests.
 */
export function Logo({ ipo }: { ipo: Pick<Ipo, 'name' | 'logoUrl'> }) {
  const [failed, setFailed] = useState(false);
  const src = ipo.logoUrl ? logoSrc(ipo.logoUrl) : null;

  return (
    <div className="logo">
      <span className="logo-initials">{initials(ipo.name)}</span>
      {src && !failed && (
        <img className="logo-img" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

/** Right-hand column: what matters depends on where the issue is in its lifecycle. */
function RowStatus({ ipo }: { ipo: Ipo }) {
  if (ipo.status === 'upcoming') {
    return (
      <div className="ipo-right">
        <div className="dim">Opens {shortDate(ipo.openDate)}</div>
      </div>
    );
  }

  if (ipo.status === 'open') {
    return (
      <div className="ipo-right">
        <div className="dim">Closes {shortDate(ipo.closeDate)}</div>
        {ipo.subscription?.total && (
          <div className="ipo-right-sub mono">{ipo.subscription.total.split('|')[0].trim()}x subscribed</div>
        )}
      </div>
    );
  }

  return (
    <div className="ipo-right">
      <div className="dim">Allotment {shortDate(ipo.boaDate)}</div>
      {ipo.listingDate && <div className="ipo-right-sub">Lists {shortDate(ipo.listingDate)}</div>}
    </div>
  );
}

export function IpoRow({ ipo }: { ipo: Ipo }) {
  const tone = gmpTone(ipo.gmp);

  return (
    <Link to={`/ipo/${ipo.id}`} className="ipo-row">
      <Logo ipo={ipo} />

      <div className="ipo-main">
        <div className="ipo-name">
          {ipo.name}
          {ipo.category === 'SME' && <span className="tag">SME</span>}
        </div>
        <div className="ipo-meta">
          <span className="mono">{ipo.priceText ? `₹${ipo.priceText}` : 'Price TBA'}</span>
          {ipo.gmp !== null && (
            <>
              <span className="faint">·</span>
              <span className={tone === 'faint' ? 'faint' : tone === 'up' ? 'pos' : 'neg'}>
                GMP <span className="mono">{gmpText(ipo.gmp)}</span>
                {ipo.gmp !== 0 && ipo.gmpPercent !== null && (
                  <span className="mono"> ({ipo.gmpPercent > 0 ? '+' : ''}{ipo.gmpPercent}%)</span>
                )}
              </span>
            </>
          )}
          {ipo.lotAmount && (
            <>
              <span className="faint">·</span>
              <span className="mono">{money(ipo.lotAmount)}/lot</span>
            </>
          )}
        </div>
      </div>

      <RowStatus ipo={ipo} />
    </Link>
  );
}

export function IpoList({ items, empty }: { items: Ipo[]; empty: string }) {
  if (items.length === 0) {
    return (
      <div className="card empty">
        <IconInbox size={26} />
        <div>{empty}</div>
      </div>
    );
  }

  return (
    <div className="ipo-list">
      {items.map((ipo) => (
        <IpoRow key={ipo.id} ipo={ipo} />
      ))}
    </div>
  );
}

export function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {count !== undefined && <span className="section-count">{count}</span>}
        {action && <div className="section-action">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export { statusLabel };
