import { useEffect, useState } from 'react';
import { IconCheck } from './Icons';

/**
 * Hero showcase card.
 *
 * The header is the brand mark's flowing wave, redrawn as three woven SVG paths in the logo's
 * own colours (sampled from the asset: teal #6dcbbd, blue #418bfd, peach #f5b293). Light
 * travels along each path continuously, so the mark reads as flowing rather than static.
 *
 * Underneath, the card replays what the product actually does: accounts checking in one by
 * one until the summary lands. It loops, and it stops dead for anyone who prefers reduced
 * motion — the final state is shown immediately instead.
 */

const ACCOUNTS = [
  { label: 'Self', status: 'allotted', detail: '154 shares' },
  { label: 'Spouse', status: 'allotted', detail: '154 shares' },
  { label: 'Father', status: 'none', detail: 'Not allotted' },
  { label: 'Mother', status: 'allotted', detail: '154 shares' },
  { label: 'Brother', status: 'none', detail: 'Not allotted' },
] as const;

/** One step per account, then the summary. */
const STEPS = ACCOUNTS.length + 1;
/** Extra ticks spent holding on the finished state before the loop restarts. */
const HOLD = 5;
const TICK_MS = 520;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function HeroCard() {
  const reduced = prefersReducedMotion();
  const [step, setStep] = useState(reduced ? STEPS : 0);

  useEffect(() => {
    if (reduced) return;

    // A plain interval with a pure updater. Scheduling from inside the updater would
    // double up under StrictMode's double-invocation and desynchronise the sweep.
    const id = window.setInterval(() => {
      setStep((current) => (current >= STEPS + HOLD ? 0 : current + 1));
    }, TICK_MS);

    return () => window.clearInterval(id);
  }, [reduced]);

  const revealed = ACCOUNTS.slice(0, Math.min(step, ACCOUNTS.length));
  const allotted = revealed.filter((a) => a.status === 'allotted').length;
  const done = step >= STEPS;

  return (
    <div className="hero-card">
      <div className="hero-card-wave">
        <svg viewBox="0 0 420 132" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="hcFade" x1="0" x2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0" />
              <stop offset="18%" stopColor="#fff" stopOpacity="1" />
              <stop offset="82%" stopColor="#fff" stopOpacity="1" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="hcMask">
              <rect width="420" height="132" fill="url(#hcFade)" />
            </mask>
          </defs>

          <g mask="url(#hcMask)" fill="none" strokeWidth="7" strokeLinecap="round">
            <path
              className="hc-path hc-1"
              stroke="#418bfd"
              d="M-20,86 C40,86 44,34 92,34 S150,92 196,92 S262,36 312,36 S392,88 440,88"
            />
            <path
              className="hc-path hc-2"
              stroke="#6dcbbd"
              d="M-20,66 C40,66 44,104 92,104 S150,44 196,44 S262,100 312,100 S392,52 440,52"
            />
            <path
              className="hc-path hc-3"
              stroke="#f5b293"
              d="M-20,104 C48,104 52,62 104,62 S168,110 214,110 S276,64 326,64 S398,104 440,104"
            />
          </g>
        </svg>
      </div>

      <div className="hero-card-body">
        <div className="hero-card-head">
          <div>
            <div className="hero-card-title">Shiprocket</div>
            <div className="hero-card-sub">Allotment · via KFin</div>
          </div>
          <span className={`hero-card-chip ${done ? 'is-done' : ''}`}>
            {done ? 'Complete' : 'Checking…'}
          </span>
        </div>

        <div className="hero-card-rows">
          {ACCOUNTS.map((account, i) => {
            const shown = i < revealed.length;
            return (
              <div key={account.label} className={`hero-card-row ${shown ? 'in' : ''}`}>
                <span className={`hero-card-dot ${account.status}`} />
                <span className="hero-card-label">{account.label}</span>
                <span className="hero-card-detail">{shown ? account.detail : ''}</span>
              </div>
            );
          })}
        </div>

        <div className={`hero-card-total ${done ? 'in' : ''}`}>
          <IconCheck size={15} />
          <span>
            <strong>{allotted} of {ACCOUNTS.length}</strong> accounts allotted
          </span>
          <span className="hero-card-amount mono">₹1,79,256</span>
        </div>
      </div>
    </div>
  );
}
