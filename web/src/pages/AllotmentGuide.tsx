import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AdSlot } from '../components/AdSlot';
import { AD_SLOTS } from '../ads';
import { useJsonLd, useSeo } from '../seo';

/**
 * The page built to be found.
 *
 * "Check IPO allotment" is the query this product actually answers, and the results for it are
 * registrar sites and app-store listings — none of which explain the thing people are stuck on,
 * which is having to repeat the lookup for every PAN in the family. So this is a real guide
 * first: the official links are here even though sending someone to a registrar costs us the
 * click. A page that only pitches would deserve to rank for nothing.
 */

/** Taken from the adapters in server/src/registrars — these are the lookups we actually drive. */
const REGISTRARS: { name: string; url: string }[] = [
  { name: 'KFin Technologies', url: 'https://ipostatus.kfintech.com/' },
  { name: 'Bigshare Services', url: 'https://ipo.bigshareonline.com/IPO_Status.html' },
  { name: 'MUFG Intime (formerly Link Intime)', url: 'https://in.mpms.mufg.com' },
  { name: 'Maashitla Securities', url: 'https://maashitla.com/allotment-status/public-issues' },
  { name: 'Cameo Corporate Services', url: 'https://ipostatus1.cameoindia.com/' },
  { name: 'Skyline Financial Services', url: 'https://www.skylinerta.com/ipo.php' },
  { name: 'Purva Sharegistry', url: 'https://www.purvashare.com' },
];

/**
 * Visible on the page and mirrored into FAQPage structured data below.
 *
 * Both copies must stay identical: Google treats FAQ markup describing answers a visitor
 * cannot see as a structured-data violation, and it is a manual-action risk, not a soft one.
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: 'How do I check IPO allotment for more than one PAN?',
    a: 'On a registrar site you check one PAN at a time — pick the issue, type the PAN, solve a captcha, then repeat for every other PAN. There is no official way to check several at once. Nirantara stores your PANs and runs the lookup for all of them, so a family with four demat accounts gets one answer instead of four lookups.',
  },
  {
    q: 'Can IPO allotment be checked automatically?',
    a: 'Yes. Nirantara watches each issue and detects the moment its registrar publishes the basis of allotment, then checks every PAN you have saved and sends one notification with the total allotted. You do not have to open anything or remember the date.',
  },
  {
    q: 'When is IPO allotment status published?',
    a: 'Usually one to two working days after the issue closes, on the basis of allotment date. The registrar publishes first; credits to your demat account and refunds of blocked funds follow a day or two later, before listing.',
  },
  {
    q: 'Why does the registrar say no records found?',
    a: 'It means that PAN has no application against that issue. Most often the application never reached the exchange, the PAN was typed wrongly, or the results are not live yet for every applicant. It does not by itself mean you were not allotted.',
  },
  {
    q: 'Does applying from more PANs improve the chance of allotment?',
    a: 'In an oversubscribed retail issue, allotment is a lottery run per application, so each valid application from a different PAN is a separate entry. Every PAN must belong to a real person with their own demat account — multiple applications on one PAN are rejected.',
  },
  {
    q: 'Is checking IPO allotment free?',
    a: 'Yes, on the registrar sites and on Nirantara. Nirantara is free to use and never handles money — it reads allotment from the registrar and shows the result.',
  },
];

export function AllotmentGuide() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  useSeo({
    title: 'IPO Allotment Status — Check Every PAN at Once | Nirantara IPO',
    description:
      'How to check IPO allotment status online: every registrar’s official link, why one PAN at a time is the slow way, and how to have all your PANs checked automatically the moment results are out.',
    path: '/ipo-allotment-status',
    type: 'article',
  });

  useJsonLd({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  });

  return (
    <div className="legal">
      <h1 className="legal-title">IPO allotment status: check every PAN at once</h1>
      <p className="legal-summary">
        Where to check allotment officially, what the result means, and how to stop repeating the
        same lookup for every PAN in the family.
      </p>

      <div className="prose">
        <h2>What allotment status tells you</h2>
        <p>
          When an IPO is oversubscribed, not everyone who applied gets shares. The registrar
          handling the issue runs the basis of allotment and publishes the result — usually one to
          two working days after the issue closes. Checking status tells you how many shares, if
          any, were allotted against a PAN. Money blocked under ASBA for unallotted applications
          is released after that, before listing day.
        </p>

        <h2>Check on the official registrar site</h2>
        <p>
          Every issue is handled by one registrar, and you have to use that registrar’s page.
          These are the seven Nirantara reads from:
        </p>
        <ul>
          {REGISTRARS.map(({ name, url }) => (
            <li key={name}>
              <a href={url} target="_blank" rel="noreferrer noopener">
                {name}
              </a>
            </li>
          ))}
        </ul>
        <p>
          Pick the company, choose PAN as the lookup, enter it, solve the captcha, submit. That is
          the authoritative answer, and it is worth confirming against your demat account before
          acting on anything.
        </p>

        <h2>The part that gets tedious</h2>
        <p>
          Households rarely apply from one PAN. Applying from a spouse’s and a parent’s demat
          account as well is ordinary practice, because in an oversubscribed retail issue
          allotment is a lottery run per application — each valid application from a different PAN
          is another entry in it.
        </p>
        <p>
          The cost is repetition. Four PANs means four lookups, four captchas, on results day,
          for every issue you applied to. Nothing on the registrar side lets you batch it.
        </p>

        <h2>Checking them all automatically</h2>
        <p>
          Nirantara saves your PANs once, encrypted, then watches each issue for the moment its
          registrar goes live. When it does, every saved PAN is checked and you get one
          notification with the total — how many accounts were allotted, how many shares, and what
          it cost. Nothing to open, no date to remember.
        </p>
        <p>
          It also tracks the money side: what each account applied for, what is still blocked, and
          what has been refunded. See the{' '}
          <Link to="/gmp">live GMP board</Link> for what is open right now.
        </p>
        <p>
          <Link to="/login?mode=signup" className="btn primary">
            Check allotment across every PAN — free
          </Link>
        </p>

        <h2>Common questions</h2>
        {FAQ.map(({ q, a }) => (
          <div key={q}>
            <h3>{q}</h3>
            <p>{a}</p>
          </div>
        ))}
      </div>

      <div className="legal-nav">
        <span>Also read</span>
        <Link to="/gmp">Live GMP</Link>
        <Link to="/disclaimer">Disclaimer</Link>
        <Link to="/privacy">How your PAN is stored</Link>
      </div>

      <AdSlot slot={AD_SLOTS.allotmentGuide} />
    </div>
  );
}
