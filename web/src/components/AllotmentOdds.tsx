import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { money } from '../format';
import type { Ipo } from '../types';

/**
 * What the retail allotment maths actually says, for this issue, for this many PANs.
 *
 * The rule people lose money to: when the retail category is oversubscribed, SEBI requires the
 * registrar to give the *minimum* lot to the *maximum* number of applicants, and when there is
 * not even one lot for everyone the winners are drawn by lottery. So a five-lot application and
 * a one-lot application from the same PAN are one entry each — identical odds, five times the
 * capital blocked. The only lever that exists is more applications from more distinct PANs.
 *
 * Nothing here can promise an allotment. The draw is a lottery and no product can influence it.
 * What this can do is show the odds honestly and stop capital being wasted on lots that buy no
 * extra chance.
 */

/** Retail subscription multiple, or null while the figure is still unpublished. */
function retailMultiple(ipo: Ipo): number | null {
  const raw = ipo.subscription?.rii;
  if (!raw) return null;
  // Values arrive as "5.77", occasionally with a timestamp suffix like "0.34 | 25th Aug 17:08".
  const n = Number(String(raw).split('|')[0].trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

const pct = (n: number) => `${(n * 100).toFixed(n >= 0.1 ? 0 : 1)}%`;

export function AllotmentOdds({ ipo }: { ipo: Ipo }) {
  const { account } = useAuth();

  // Signed in, the honest default is the number of PANs actually saved. Signed out it starts at
  // one, and moving the stepper is the argument for saving more.
  const { data: pans } = useQuery({
    queryKey: ['pans'],
    queryFn: api.pans,
    enabled: Boolean(account),
  });
  const savedPans = pans?.filter((p) => p.isActive).length ?? 0;
  const [override, setOverride] = useState<number | null>(null);
  const applications = override ?? Math.max(savedPans, 1);

  const multiple = retailMultiple(ipo);
  if (multiple === null) return null;

  const undersubscribed = multiple < 1;
  const perApplication = Math.min(1, 1 / multiple);
  const atLeastOne = 1 - Math.pow(1 - perApplication, applications);

  const lotCost = ipo.lotAmount ?? null;
  const spread = lotCost ? lotCost * applications : null;

  return (
    <div className="card card-pad odds">
      <div className="odds-head">
        <h2 className="section-title">Allotment odds</h2>
        <span className="odds-sub">Retail subscribed {multiple.toFixed(2)}×</span>
      </div>

      {undersubscribed ? (
        <>
          <p className="odds-lede">
            Retail is not full yet. Every valid application should be allotted in full, so this is
            the rare case where applying for more lots from one PAN actually gets you more shares.
          </p>
          <p className="odds-note">
            This can change quickly — retail usually fills on the final day. Check again before
            the issue closes.
          </p>
        </>
      ) : (
        <>
          <div className="odds-figures">
            <div>
              <div className="odds-label">One application</div>
              <div className="odds-value">{pct(perApplication)}</div>
            </div>
            <div>
              <div className="odds-label">
                From {applications} PAN{applications > 1 ? 's' : ''}
              </div>
              <div className="odds-value strong">{pct(atLeastOne)}</div>
            </div>
          </div>

          <div className="odds-bar" role="img" aria-label={`${pct(atLeastOne)} chance of at least one allotment`}>
            <span style={{ width: `${Math.min(100, atLeastOne * 100)}%` }} />
          </div>

          <div className="odds-stepper">
            <span>Applications</span>
            <button
              type="button"
              onClick={() => setOverride(Math.max(1, applications - 1))}
              disabled={applications <= 1}
              aria-label="One application fewer"
            >
              &minus;
            </button>
            <b className="mono">{applications}</b>
            <button
              type="button"
              onClick={() => setOverride(Math.min(20, applications + 1))}
              disabled={applications >= 20}
              aria-label="One application more"
            >
              +
            </button>
            {spread !== null && <span className="odds-capital">{money(spread)} blocked</span>}
          </div>

          <p className="odds-lede">
            <strong>Apply the minimum lot from each PAN.</strong> Because retail is oversubscribed,
            the registrar allots one lot to as many applicants as it can and draws the winners by
            lottery — so {applications > 1 ? `${applications} lots from one PAN` : 'several lots from one PAN'}{' '}
            is a single entry, while the same money spread across {applications} PAN
            {applications > 1 ? 's' : ''} is {applications} entries.
          </p>

          {!account && (
            <Link to="/login?mode=signup" className="btn primary" style={{ marginTop: 4 }}>
              Track every PAN and check them automatically
            </Link>
          )}
        </>
      )}

      <p className="odds-fine">
        An estimate from the published retail subscription figure, not a prediction. Allotment in
        an oversubscribed issue is a lottery run by the registrar — no service can influence it or
        guarantee a result.
      </p>
    </div>
  );
}
