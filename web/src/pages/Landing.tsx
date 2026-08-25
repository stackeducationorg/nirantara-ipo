import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import {
  IconBell,
  IconCheck,
  IconList,
  IconLock,
  IconMonitor,
  IconMoon,
  IconSun,
  IconTarget,
  IconTrend,
  IconWallet,
} from '../components/Icons';
import { FallingStars } from '../components/FallingStars';
import { HeroCard } from '../components/HeroCard';
import { gmpText, gmpTone } from '../format';
import { useJsonLd, useSeo, SITE_ORIGIN } from '../seo';
import { useThemeMode } from '../theme';
import '../landing.css';

/**
 * Soft gradient tiles scattered down both page gutters. Each entry is
 * [top %, inset from the outer edge %, size px, gradient] — hand-placed rather
 * than randomised so the arrangement is stable between renders.
 */
const TILES: [number, number, number, string][] = [
  [2, 62, 84, 'linear-gradient(150deg,#cfe0f5,#a9c8ea)'],
  [7, 18, 62, 'linear-gradient(160deg,#dbeafe,#bfd9f5)'],
  [13, 48, 96, 'linear-gradient(140deg,#bcd9ef,#d8ecdf)'],
  [20, 8, 58, 'linear-gradient(165deg,#4f7fe0,#7ea6ee)'],
  [26, 40, 76, 'linear-gradient(150deg,#c6e0e8,#a9cfe0)'],
  [34, 14, 68, 'linear-gradient(155deg,#dceaf8,#c3ddf2)'],
  [42, 52, 90, 'linear-gradient(145deg,#b9d6ea,#d6ead9)'],
  [50, 20, 54, 'linear-gradient(160deg,#e3eefb,#cadff4)'],
  [58, 44, 78, 'linear-gradient(150deg,#c9dff0,#aecfe6)'],
  [66, 10, 64, 'linear-gradient(165deg,#dbe9f7,#bdd7ee)'],
];

function Decor() {
  const gutter = (side: 'left' | 'right') => (
    <div className={`lp-gutter ${side}`}>
      {TILES.map(([top, inset, size, bg], i) => (
        <span
          key={`${side}-${i}`}
          className="lp-tile"
          style={{
            top: `${side === 'left' ? top : top + 4}%`,
            [side]: `${inset}%`,
            width: size,
            height: size,
            background: bg,
          }}
        />
      ))}
    </div>
  );

  return (
    <div className="lp-decor" aria-hidden="true">
      {gutter('left')}
      {gutter('right')}
    </div>
  );
}

function ThemeButton() {
  const { mode, cycle } = useThemeMode();
  const Icon = mode === 'light' ? IconSun : mode === 'dark' ? IconMoon : IconMonitor;
  return (
    <button className="icon-btn" onClick={cycle} aria-label="Change theme" title="Change theme">
      <Icon size={16} />
    </button>
  );
}

/**
 * Real GMP pulled from the public endpoint. Showing the product's actual output beats any
 * mock-up, and it degrades to nothing if the API is unreachable.
 */
function LiveStrip() {
  const { data } = useQuery({
    queryKey: ['landing-gmp'],
    queryFn: api.gmpBoard,
    refetchInterval: 5 * 60_000,
    retry: 0,
  });

  const top = (data ?? []).filter((i) => i.gmp !== null && i.gmp !== 0).slice(0, 4);
  if (top.length === 0) return null;

  return (
    <div className="lp-proof">
      <div className="lp-proof-head">
        <span className="lp-live-dot" />
        Live grey market premium
      </div>
      <div className="lp-proof-grid">
        {top.map((ipo) => {
          const tone = gmpTone(ipo.gmp);
          return (
            <div className="lp-proof-cell" key={ipo.id}>
              <div className="lp-proof-name">{ipo.name}</div>
              <div className={`lp-proof-gmp mono ${tone === 'up' ? 'pos' : tone === 'down' ? 'neg' : 'faint'}`}>
                {gmpText(ipo.gmp)}
                {ipo.gmpPercent !== null && (
                  <span className="faint" style={{ fontSize: 12.5, fontWeight: 500 }}>
                    {' '}
                    {ipo.gmpPercent}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stats() {
  const { data } = useQuery({ queryKey: ['landing-dash'], queryFn: api.dashboard, retry: 0 });

  const tracked = data ? data.open.length + data.upcoming.length + data.awaitingAllotment.length : null;

  const items = [
    { value: tracked !== null ? String(tracked) : '—', label: 'IPOs being tracked' },
    { value: data ? String(data.open.length) : '—', label: 'Open right now' },
    { value: '7', label: 'Registrars supported' },
    { value: 'Unlimited', label: 'PANs per account' },
  ];

  return (
    <div className="lp-stats">
      {items.map((item) => (
        <div className="lp-stat" key={item.label}>
          <div className="lp-stat-num mono">{item.value}</div>
          <div className="lp-stat-label">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

const FEATURES = [
  {
    Icon: IconTrend,
    title: 'Live GMP and full IPO details',
    body: 'Grey market premium, subscription figures, price band, lot size and the full timeline for every mainboard and SME issue — refreshed automatically.',
  },
  {
    Icon: IconWallet,
    title: 'Know where your money is',
    body: 'Record how many lots each account applied for. See exactly how much is blocked, what got debited, and what is owed back after allotment.',
  },
  {
    Icon: IconBell,
    title: 'Alerts that actually matter',
    body: 'IPO opens, closing tomorrow, allotment out, listing day and sharp GMP moves — each one switchable, on the web and on your phone.',
  },
  {
    Icon: IconLock,
    title: 'Your PANs stay encrypted',
    body: 'Every PAN is encrypted at rest and only ever sent to the official registrar. The app shows them masked, never in full.',
  },
  {
    Icon: IconMonitor,
    title: 'Website and mobile app',
    body: 'One account across both. Sign in with your password, or link a device instantly with a sync key — the same PAN book either way.',
  },
];

const STEPS = [
  {
    title: 'Save your PANs once',
    body: 'Add every family demat account with a label — Self, Spouse, Father. You never type a PAN again.',
  },
  {
    title: 'Mark what you applied for',
    body: 'Open an IPO and set the lots per account, or apply from all of them in one tap. The blocked amount is worked out for you.',
  },
  {
    title: 'We check and tell you',
    body: 'The moment allotment goes live we sweep every PAN and send one notification with the totals. Nothing to open, nothing to type.',
  },
];

export function Landing() {
  useSeo({
    title: 'Nirantara IPO — Live GMP, IPO Calendar & Automatic Allotment Check',
    description:
      'Track live IPO grey market premium, price bands and subscription figures. Save your PANs once and every one of them is checked automatically the moment allotment is out.',
    path: '/',
  });

  // Three entities in one block. WebSite and Organization name the site under a result;
  // SoftwareApplication is the one that matters commercially, because it is what tells Google
  // this is an app at all — "ipo allotment app" is answered almost entirely with app listings.
  //
  // Deliberately no aggregateRating. Inventing a rating and review count is the single most
  // common structured-data violation and carries a manual-action risk, and there are no real
  // ratings to declare until the app is on a store.
  useJsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_ORIGIN}/#organization`,
        name: 'Nirantara IPO',
        url: SITE_ORIGIN,
        logo: `${SITE_ORIGIN}/icon-512.png`,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_ORIGIN}/#website`,
        name: 'Nirantara IPO',
        url: SITE_ORIGIN,
        description:
          'Live IPO GMP, subscription figures and automatic allotment checking across every saved PAN.',
        publisher: { '@id': `${SITE_ORIGIN}/#organization` },
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Nirantara IPO',
        applicationCategory: 'FinanceApplication',
        operatingSystem: 'Android, Web',
        url: SITE_ORIGIN,
        downloadUrl: `${SITE_ORIGIN}/download`,
        image: `${SITE_ORIGIN}/icon-512.png`,
        description:
          'Checks IPO allotment automatically across every PAN you save, the moment the registrar publishes, and tracks live GMP and the money blocked against each demat account.',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
        featureList: [
          'Automatic IPO allotment check across every saved PAN',
          'Live IPO grey market premium and subscription figures',
          'Alerts when an IPO opens, closes, and when allotment is published',
          'Tracks money blocked and refunded per demat account',
        ],
        publisher: { '@id': `${SITE_ORIGIN}/#organization` },
      },
    ],
  });

  const year = new Date().getFullYear();

  return (
    <div className="lp">
      <Decor />

      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/" className="lp-brand">
            <img src="/logo-mark.png" alt="" />
            Nirantara IPO
          </Link>

          <nav className="lp-nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#security">Security</a>
          </nav>

          <div className="lp-nav-right">
            <ThemeButton />
            <Link to="/login" className="btn">
              Log in
            </Link>
            <Link to="/login?mode=signup" className="btn primary">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-grid">
          <div className="lp-hero-copy">
            <div className="lp-eyebrow">
              <b>NEW</b> Automatic allotment across every PAN
            </div>

            <h1 className="lp-h1">
              Stop checking IPO allotment <em>one PAN at a time</em>
            </h1>

            <p className="lp-lede">
              Nirantara tracks live GMP, records what every family account applied for, and checks
              allotment across all of them the moment results are published — then tells you the
              total.
            </p>

            <div className="lp-cta-row">
              <Link to="/login?mode=signup" className="btn primary lg">
                Get started free
              </Link>
              <a href="#how" className="btn lg">
                See how it works
              </a>
            </div>

            <div className="lp-cta-note">
              No card required. Takes about ten seconds. ·{' '}
              <Link to="/download" style={{ textDecoration: 'underline' }}>
                Get the Android app
              </Link>
            </div>
          </div>

          <div className="lp-hero-showcase">
            <HeroCard />
          </div>
        </div>

        <div className="lp-section" style={{ padding: 0 }}>
          <LiveStrip />
          <Stats />
        </div>
      </section>

      <section className="lp-block lp-section" id="features">
        <div className="lp-block-head">
          <div className="lp-kicker">What you get</div>
          <h2 className="lp-h2">Everything an IPO investor checks, in one place</h2>
          <p className="lp-sub">
            Built for people applying from several demat accounts, where checking each one by hand is
            the whole problem.
          </p>
        </div>

        <div className="lp-features">
          <div className="lp-card wide">
            <div className="lp-card-body">
              <div className="lp-card-icon">
                <IconTarget size={19} />
              </div>
              <h3>Allotment checked for you, across every account</h3>
              <p>
                Other trackers make you pick an IPO, type a PAN, solve a captcha, and repeat for every
                account — then stay silent when results land. Nirantara polls the registrar itself, and
                the moment allotment is out it sweeps all your saved PANs and sends one summary.
              </p>
            </div>
            <div className="lp-callout">
              <div className="lp-callout-figure pos">3 of 7</div>
              <div className="lp-callout-note">
                accounts allotted &middot; 300 shares &middot; &#8377;41,400
              </div>
              <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                <IconCheck size={14} className="pos" />
                <span className="dim">Sent as a notification, automatically</span>
              </div>
            </div>
          </div>

          {FEATURES.map(({ Icon, title, body }) => (
            <div className="lp-card" key={title}>
              <div className="lp-card-icon">
                <Icon size={19} />
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-block lp-section" id="how">
        <div className="lp-block-head">
          <div className="lp-kicker">How it works</div>
          <h2 className="lp-h2">Three steps, then it runs itself</h2>
        </div>

        <div className="lp-steps">
          {STEPS.map((step) => (
            <div className="lp-step" key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-block lp-section" id="security">
        <div className="lp-block-head">
          <div className="lp-kicker">Security</div>
          <h2 className="lp-h2">Your PAN is the most sensitive thing here</h2>
          <p className="lp-sub">So it is treated that way.</p>
        </div>

        <div className="lp-features">
          <div className="lp-card">
            <div className="lp-card-icon">
              <IconLock size={19} />
            </div>
            <h3>Encrypted at rest</h3>
            <p>
              PANs are stored with AES-256-GCM encryption. The API returns them masked, and the
              plaintext leaves the database only to make a registrar lookup.
            </p>
          </div>
          <div className="lp-card">
            <div className="lp-card-icon">
              <IconCheck size={19} />
            </div>
            <h3>Official sources only</h3>
            <p>
              Allotment comes from the registrar handling the issue — KFin, Bigshare and others.
              Nothing is guessed or scraped from third parties.
            </p>
          </div>
          <div className="lp-card">
            <div className="lp-card-icon">
              <IconList size={19} />
            </div>
            <h3>Passwords done properly</h3>
            <p>
              Hashed with scrypt and a per-password salt, rate limited against guessing, and changing
              your password signs every other device out.
            </p>
          </div>
        </div>
      </section>

      {/* Light call-to-action band, then the dark plate — the closing sequence. */}
      <section className="lp-cta-band">
        <h2>Never miss an allotment again</h2>
        <p>Add your PANs once. We handle every IPO after that.</p>
        <div className="lp-cta-row">
          <Link to="/login?mode=signup" className="btn pill">
            Create your free account
          </Link>
          <a href="#how" className="btn lg" style={{ borderRadius: 999 }}>
            See how it works
          </a>
        </div>
      </section>

      <footer className="lp-plate">
        <FallingStars tone="plate" />
        <div className="lp-plate-inner">
          <p className="lp-plate-statement">
            Every IPO. Every account.
            <br />
            <span>Checked for you, automatically.</span>
          </p>

          <div className="lp-plate-top">
            <div className="lp-plate-brand">
              <div className="lp-plate-name">
                <img src="/logo-mark.png" alt="" />
                Nirantara IPO
              </div>
              <p className="lp-plate-tagline">
                Live GMP, money tracking and automatic allotment across every PAN you save.
              </p>
              <Link to="/login?mode=signup" className="lp-plate-cta">
                Get started free
              </Link>
            </div>

            <div className="lp-plate-cols">
              <div className="lp-plate-col">
                <h4>Product</h4>
                <a href="#features">Features</a>
                <a href="#how">How it works</a>
                <a href="#security">Security</a>
                <Link to="/login">Log in</Link>
              </div>

              <div className="lp-plate-col">
                <h4>Data</h4>
                <span>Registrars</span>
                <span>Subscription figures</span>
                <span>Grey market premium</span>
                <span>Allotment results</span>
              </div>

              <div className="lp-plate-col">
                <h4>Legal</h4>
                <Link to="/terms">Terms of Service</Link>
                <Link to="/privacy">Privacy Policy</Link>
                <Link to="/disclaimer">Disclaimer</Link>
              </div>
            </div>
          </div>

          {/* Oversized wordmark closing the plate. */}
          <div className="lp-wordmark" aria-hidden="true">
            NIRANTARA
          </div>

          <div className="lp-plate-bottom">
            <span>
              All rights reserved to <strong>Nirantara IPO</strong> © {year}.
            </span>
            <div className="lp-plate-credit">
              <span>
                Developed by{' '}
                <a href="https://stackeducation.in" target="_blank" rel="noreferrer noopener">
                  stackeducation.in
                </a>
              </span>
              <ThemeButton />
            </div>
          </div>

          <p className="lp-plate-disclaimer">
            Grey market premium is an unofficial market signal compiled from publicly reported figures.
            It is not a prediction of listing price and nothing here is investment advice. Allotment
            data is sourced from the registrar handling each issue; always confirm against the
            registrar or your broker before acting.
          </p>
        </div>
      </footer>
    </div>
  );
}
