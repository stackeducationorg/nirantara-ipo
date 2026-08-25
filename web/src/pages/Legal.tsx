import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSeo } from '../seo';

/**
 * Everything a lawyer or a regulator needs to be able to reach is kept here rather than
 * scattered through the prose, so changing the entity or the contact address is one edit.
 *
 * CONTACT and GRIEVANCE must be mailboxes that a person actually reads: the DPDP Act
 * requires a reachable point of contact for data-protection queries, and an address that
 * bounces is worse than no address at all.
 */
const ENTITY = 'Nirantara IPO';
const CONTACT = 'support@nirantara.cloud';
const GRIEVANCE = 'grievance@nirantara.cloud';
const JURISDICTION = 'Bengaluru, Karnataka';
const UPDATED = '21 August 2026';

const REGISTRARS = [
  'KFin Technologies',
  'Bigshare Services',
  'MUFG Intime (formerly Link Intime)',
  'Maashitla Securities',
  'Purva Sharegistry',
  'Skyline Financial Services',
  'Cameo Corporate Services',
];

function LegalLayout({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  const { pathname } = useLocation();

  useSeo({ title: `${title} | ${ENTITY}`, description: summary, path: pathname });

  // These pages are reached from links in the footer, so the visitor is always scrolled to the
  // bottom when they click. Without this they land at the foot of a long document.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="legal">
      <h1 className="legal-title">{title}</h1>
      <p className="legal-summary">{summary}</p>
      <p className="legal-updated">Last updated {UPDATED}</p>

      <div className="legal-prose">{children}</div>

      <div className="legal-nav">
        <span>Also read</span>
        <Link to="/terms">Terms of Service</Link>
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/disclaimer">Disclaimer</Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ terms */

export function Terms() {
  return (
    <LegalLayout
      title="Terms of Service"
      summary={`The agreement between you and ${ENTITY} for use of this website and mobile app.`}
    >
      <h2>1. Who these terms are between</h2>
      <p>
        These terms govern your use of {ENTITY} (the “Service”), covering both the website and
        the mobile app. By creating an account or using the Service you agree to them. If you do
        not agree, do not use the Service.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 18 years old and legally able to enter a contract under Indian law.
        The Service is built around Indian IPO processes and is intended for residents of India.
        You may only add a PAN that belongs to you or that you are authorised by the holder to
        manage.
      </p>

      <h2>3. What the Service is — and is not</h2>
      <p>
        {ENTITY} is an <strong>information and tracking tool</strong>. It shows IPO details,
        grey market premium figures, subscription data and allotment results, and it records what
        you tell it you applied for.
      </p>
      <p>We want to be unambiguous about the limits of that:</p>
      <ul>
        <li>
          We are <strong>not</strong> a stock broker, syndicate member, registrar, depository
          participant, or any other intermediary registered with SEBI.
        </li>
        <li>
          We <strong>do not</strong> submit IPO applications or place bids on your behalf, and we
          cannot. Applications must be made through a registered intermediary or your bank.
        </li>
        <li>
          We <strong>never</strong> handle, hold, block or transfer your money. Nothing in the
          Service moves funds.
        </li>
        <li>
          We <strong>do not</strong> provide investment advice or recommendations. See our{' '}
          <Link to="/disclaimer">Disclaimer</Link>.
        </li>
      </ul>
      <p>
        Amounts shown in the money tracker are calculated from what <em>you</em> recorded. They
        are a convenience, not a statement of account. Your bank and broker are authoritative.
      </p>

      <h2>4. Your account</h2>
      <p>
        You are responsible for keeping your password and your sync key confidential. The sync
        key pairs new devices to your account — anyone holding it can reach your saved data, so
        treat it like a password. Tell us promptly at{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a> if you believe your account has been accessed
        without your permission.
      </p>
      <p>
        You are responsible for the accuracy of what you enter, including PANs and the
        applications you record.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>add a PAN you neither own nor are authorised to manage;</li>
        <li>
          scrape, resell or systematically extract data from the Service, or use automated means
          to access it beyond normal personal use;
        </li>
        <li>attempt to breach, probe or disrupt the Service or its infrastructure;</li>
        <li>use the Service for anything unlawful, or to impersonate anyone.</li>
      </ul>

      <h2>6. Data accuracy and availability</h2>
      <p>
        IPO details, GMP and subscription figures are compiled from public sources. Allotment
        results are read from the registrar handling each issue. Both can be delayed, incomplete
        or wrong, and registrars change their systems without notice.
      </p>
      <p>
        The Service is provided “as is” and “as available”. We do not warrant that it will be
        uninterrupted, timely, or error-free, and we may change or discontinue any part of it.
      </p>

      <h2>7. Intellectual property</h2>
      <p>
        The Service, its design, and its original content belong to {ENTITY}. Market data
        displayed remains the property of its respective sources. You keep ownership of the data
        you enter, and you grant us only the permission needed to operate the Service for you —
        principally, to send your PAN to the relevant registrar to check allotment.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, {ENTITY} is not liable for any indirect,
        incidental, consequential or punitive loss, or for any loss of profits, investment
        losses, missed allotments, or losses arising from reliance on information shown in the
        Service, a missed or delayed notification, or an outage.
      </p>
      <p>
        Nothing here limits liability that cannot lawfully be limited, including liability for
        fraud.
      </p>

      <h2>9. Suspension and termination</h2>
      <p>
        You may delete your account at any time from Accounts, or by writing to{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We may suspend or terminate accounts that
        breach these terms or that we reasonably believe are being used unlawfully.
      </p>

      <h2>10. Changes</h2>
      <p>
        We may update these terms. Material changes will be reflected in the “last updated” date
        above, and continued use after a change means you accept the revised terms.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These terms are governed by the laws of India. The courts at {JURISDICTION} have
        exclusive jurisdiction over any dispute arising out of them.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </LegalLayout>
  );
}

/* ---------------------------------------------------------------- privacy */

export function Privacy() {
  return (
    <LegalLayout
      title="Privacy Policy"
      summary="What we collect, why we collect it, who it reaches, and how to get rid of it."
    >
      <p>
        This policy explains how {ENTITY} handles your personal data. It is written to meet the
        Digital Personal Data Protection Act, 2023 (“DPDP Act”), under which we are a Data
        Fiduciary and you are a Data Principal.
      </p>

      <h2>1. What we collect</h2>
      <h3>Account information</h3>
      <ul>
        <li>Your email address and display name.</li>
        <li>
          A password, if you set one. We store only an <strong>scrypt</strong> hash — never the
          password itself.
        </li>
        <li>
          If you sign in with Google, an identifier from Google. We do not receive your Google
          password.
        </li>
        <li>A sync key, which is what lets you pair another device to the same account.</li>
      </ul>

      <h3>PAN and demat details</h3>
      <ul>
        <li>
          Each PAN you save, together with the label you give it (“Self”, “Spouse”) and, where
          available, the holder name returned by the registrar.
        </li>
        <li>
          Every PAN is <strong>encrypted at rest with AES-256-GCM</strong>. We also store a
          one-way hash of it, used solely to stop the same PAN being added twice to one account.
        </li>
        <li>The app displays PANs masked and does not show them in full.</li>
      </ul>

      <h3>What you record</h3>
      <ul>
        <li>The IPOs and lot counts you mark as applied for, and the amounts derived from them.</li>
        <li>Your watchlist, hidden issues, and alert preferences.</li>
        <li>Allotment results retrieved on your behalf.</li>
      </ul>

      <h3>Device and technical data</h3>
      <ul>
        <li>
          A push notification token for each device you enable alerts on (Expo for the app, Web
          Push for browsers), so we can reach you when allotment lands.
        </li>
        <li>A hashed session token per signed-in device, and the platform it is on.</li>
        <li>Standard server logs, used for security and debugging.</li>
      </ul>
      <p>
        We do <strong>not</strong> collect your bank details, demat holdings, trading activity, or
        your broker credentials. We never ask for them, and you should never give them to us.
      </p>

      <h2>2. Why we use it</h2>
      <ul>
        <li>
          <strong>To check allotment.</strong> This is the core purpose. Your PAN is decrypted at
          the moment of the lookup and sent to the registrar for that specific issue.
        </li>
        <li>
          <strong>To notify you</strong> when an IPO opens or closes, when allotment is published,
          and what your result was.
        </li>
        <li>
          <strong>To show your money position</strong> — what you recorded as applied, blocked,
          refunded or invested.
        </li>
        <li>
          <strong>To operate and secure the Service</strong>, including rate limiting and abuse
          prevention.
        </li>
      </ul>
      <p>
        We do not sell your personal data. We do not use your PAN for anything other than
        allotment lookups.
      </p>

      <h2>3. Who your data reaches</h2>
      <h3>Registrars</h3>
      <p>
        To check an allotment we must send your PAN to the registrar handling that issue, exactly
        as you would if you used their website yourself. Depending on the issue, that is one of:
      </p>
      <ul>
        {REGISTRARS.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p>Their handling of that lookup is governed by their own privacy policies.</p>

      <h3>Service providers</h3>
      <ul>
        <li>
          <strong>Google</strong> — only if you choose Google sign-in, to verify who you are.
        </li>
        <li>
          <strong>Expo</strong> and <strong>Google Firebase Cloud Messaging</strong> — to deliver
          push notifications to your device.
        </li>
        <li>
          <strong>Vercel</strong> (website hosting) and <strong>Google Cloud</strong> (API
          hosting).
        </li>
      </ul>
      <p>
        Market data comes <em>into</em> the Service from public sources such as InvestorGain. No
        personal data of yours is sent to them.
      </p>

      <h3>Legal</h3>
      <p>
        We may disclose data where required by Indian law, a court order, or a lawful request
        from an authority.
      </p>

      <h2>4. How long we keep it</h2>
      <p>
        Account data is kept while your account is open. When you delete your account, your
        account record, PANs, applications, watchlist, preferences and device tokens are deleted
        along with it. Aggregate market data — IPO details and GMP history, which contain nothing
        personal — is retained. Backups and server logs age out on their own cycle.
      </p>

      <h2>5. Security</h2>
      <ul>
        <li>PANs encrypted at rest with AES-256-GCM.</li>
        <li>Passwords hashed with scrypt and a per-password salt.</li>
        <li>All traffic between your device and our servers over HTTPS.</li>
        <li>Sign-in rate limited against guessing; changing your password signs out other devices.</li>
      </ul>
      <p>
        No system is perfectly secure, and we cannot guarantee absolute security. If a breach
        affects your personal data we will notify you and the Data Protection Board as the DPDP
        Act requires.
      </p>

      <h2>6. Your rights</h2>
      <p>Under the DPDP Act you may:</p>
      <ul>
        <li>ask what personal data of yours we hold and how it is processed;</li>
        <li>have inaccurate data corrected, or complete it;</li>
        <li>have your data erased — deleting your account does this immediately;</li>
        <li>withdraw consent, by removing a PAN, turning off alerts, or closing your account;</li>
        <li>nominate someone to exercise these rights if you die or become incapacitated;</li>
        <li>raise a grievance, as below.</li>
      </ul>
      <p>
        Most of these are available directly in the app. For anything else, write to{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>7. Children</h2>
      <p>
        The Service is not intended for anyone under 18 and we do not knowingly collect data from
        children. If you believe a child has given us data, tell us and we will delete it.
      </p>

      <h2>8. Grievance officer</h2>
      <p>
        If you are unhappy with how we have handled your data, contact our grievance officer at{' '}
        <a href={`mailto:${GRIEVANCE}`}>{GRIEVANCE}</a>. We aim to respond within 30 days. You may
        escalate to the Data Protection Board of India if you remain dissatisfied.
      </p>

      <h2>9. Changes</h2>
      <p>
        We will update this policy as the Service changes, and revise the “last updated” date. If
        a change materially affects how we use your data, we will tell you in the app.
      </p>
    </LegalLayout>
  );
}

/* ------------------------------------------------------------- disclaimer */

export function Disclaimer() {
  return (
    <LegalLayout
      title="Disclaimer"
      summary="Nothing here is investment advice, and grey market premium is not a price."
    >
      <h2>Not investment advice</h2>
      <p>
        Everything on {ENTITY} is for information only. Nothing on this website or in the app is
        investment, financial, legal or tax advice, nor a recommendation, offer or solicitation to
        buy or sell any security. We are not a SEBI-registered investment adviser, research
        analyst, or stock broker.
      </p>
      <p>
        Applying to an IPO carries risk, including loss of capital. Decide for yourself, read the
        issue’s official prospectus (the RHP), and consult a SEBI-registered adviser if you need
        advice.
      </p>

      <h2>About grey market premium</h2>
      <p>This is the part most worth reading carefully.</p>
      <ul>
        <li>
          The grey market is <strong>unofficial and unregulated</strong>. SEBI does not recognise
          it, does not oversee it, and grey market transactions have no legal standing.
        </li>
        <li>
          GMP figures shown here are compiled from publicly reported numbers. They are{' '}
          <strong>indicative sentiment, not a quoted price</strong>, and cannot be independently
          verified.
        </li>
        <li>
          GMP is <strong>not a prediction of listing price</strong>. It moves sharply, is thinly
          traded, and can be influenced by interested parties. Issues have listed far below a
          strong GMP, and above a weak one.
        </li>
        <li>We do not facilitate, encourage or participate in grey market transactions.</li>
      </ul>

      <h2>Allotment and issue data</h2>
      <p>
        Allotment results are read from the registrar handling each issue. Data may be delayed,
        incomplete, or unavailable while a registrar is publishing, and registrars change their
        systems without notice.
      </p>
      <p>
        <strong>
          Always confirm allotment against the registrar’s own website, your broker, or your
          demat account before acting on it.
        </strong>{' '}
        Treat what you see here as a convenience, not as proof.
      </p>

      <h2>Money figures</h2>
      <p>
        Amounts blocked, refunded and invested are calculated from what you recorded — not from
        your bank. They will be wrong if what you entered was wrong. Your bank statement and your
        broker are authoritative.
      </p>

      <h2>No guarantee of accuracy or availability</h2>
      <p>
        We make a genuine effort to keep information correct and current, but we do not warrant
        its accuracy, completeness or timeliness. Notifications depend on networks and third-party
        services and may be delayed or fail to arrive. Do not rely on {ENTITY} as your only source
        for anything time-critical.
      </p>

      <h2>No liability</h2>
      <p>
        To the fullest extent permitted by law, {ENTITY} accepts no liability for any loss arising
        from use of, or reliance on, anything in the Service — including investment losses, missed
        allotments, missed deadlines, or delayed and undelivered notifications.
      </p>

      <h2>External links</h2>
      <p>
        Links to registrars, brokers and other third parties are provided for convenience. We do
        not control them and are not responsible for their content, accuracy or practices.
      </p>

      <h2>Questions</h2>
      <p>
        Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. See also our{' '}
        <Link to="/terms">Terms of Service</Link> and{' '}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalLayout>
  );
}
