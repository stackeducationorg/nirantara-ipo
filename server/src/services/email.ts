import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { logger } from '../util/logger.js';
import type { AllotmentSummary } from './allotment.js';
import type { IpoRow } from './ipoStore.js';

const log = logger('email');

/**
 * Transactional email over SMTP.
 *
 * Created lazily and reused: Gmail throttles connection churn, and building a transport per
 * message would open a fresh TLS session for every account in an allotment sweep.
 */
let transport: Transporter | null = null;

function mailer(): Transporter | null {
  if (!config.smtp.user || !config.smtp.pass) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
      pool: true,
      maxConnections: 2,
    });
  }
  return transport;
}

/**
 * The logo travels with the message as an inline attachment rather than a hotlinked URL.
 * Gmail and Outlook block remote images from unknown senders by default, which would leave
 * a broken box at the top of every email; a cid: reference always renders.
 */
const LOGO_CID = 'nirantara-logo';
const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../assets/logo.png');
const logoBuffer: Buffer | null = (() => {
  try {
    return fs.readFileSync(LOGO_PATH);
  } catch {
    log.warn(`logo not found at ${LOGO_PATH} — emails will fall back to a text wordmark`);
    return null;
  }
})();

export function emailConfigured(): boolean {
  return Boolean(config.smtp.user && config.smtp.pass);
}

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const money = (n: number) => inr.format(n);
const num = (n: number) => new Intl.NumberFormat('en-IN').format(n);

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Recipient {
  email: string;
  name: string | null;
}

function recipientFor(accountId: string): Recipient | null {
  const row = db.prepare('SELECT email, name FROM accounts WHERE id = ?').get(accountId) as
    | { email: string | null; name: string | null }
    | undefined;
  return row?.email ? { email: row.email, name: row.name } : null;
}

/**
 * Builds the allotment result email.
 *
 * The listing-gain figure is derived from grey market premium, which is an unofficial and
 * frequently wrong signal. It is presented as an estimate with that caveat attached, and
 * never as advice to sell — this is a tracking product, not a broker.
 */
function renderAllotmentEmail(
  to: Recipient,
  ipo: IpoRow,
  summary: AllotmentSummary,
  gmp: number | null,
): { subject: string; html: string; text: string } {
  const won = summary.allottedAccounts > 0;
  const first = to.name?.trim().split(/\s+/)[0] ?? 'there';

  const allotted = summary.results.filter((r) => r.status === 'allotted');
  const missed = summary.results.filter((r) => r.status === 'not_allotted');

  // GMP is quoted per share, so the estimate scales with shares actually allotted.
  const estGain = gmp !== null && summary.totalShares > 0 ? gmp * summary.totalShares : null;
  const listingValue = estGain !== null ? summary.totalAmount + estGain : null;

  const subject = won
    ? `Allotted — ${summary.allottedAccounts} of ${summary.totalAccounts} accounts in ${ipo.name}`
    : `${ipo.name} — no allotment this time`;

  const row = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding:9px 0;color:#52525b;font-size:14px;">${esc(label)}</td>
      <td style="padding:9px 0;text-align:right;font-size:14px;font-weight:${strong ? 700 : 500};color:#09090b;">${value}</td>
    </tr>`;

  const accountRows = [...allotted, ...missed]
    .map(
      (r) => `
      <tr>
        <td style="padding:10px 0;border-top:1px solid #ececf0;">
          <div style="font-weight:600;font-size:14px;color:#09090b;">${esc(r.nameOnRecord ?? r.label)}</div>
          <div style="font-size:12px;color:#8b8b94;">${esc(r.panMasked)}${
            r.nameOnRecord ? ' · ' + esc(r.label) : ''
          }</div>
        </td>
        <td style="padding:10px 0;border-top:1px solid #ececf0;text-align:right;white-space:nowrap;">
          ${
            r.status === 'allotted'
              ? `<span style="color:#12864c;font-weight:700;font-size:14px;">${num(r.allottedQty ?? 0)} shares</span>
                 <div style="font-size:12px;color:#8b8b94;">${money(r.amount ?? 0)}</div>`
              : `<span style="color:#c8324a;font-weight:600;font-size:13px;">Not allotted</span>`
          }
        </td>
      </tr>`,
    )
    .join('');

  const headline = won
    ? `You were allotted in <strong>${summary.allottedAccounts}</strong> of ${summary.totalAccounts} account${
        summary.totalAccounts === 1 ? '' : 's'
      }.`
    : `No allotment this time across ${summary.totalAccounts} account${summary.totalAccounts === 1 ? '' : 's'}.`;

  const closing = won
    ? `Oversubscription decides most of this, and it is largely luck. Keep applying across your accounts — that is what improves the odds over a year, not any single issue.`
    : `Nothing was allotted, so your blocked funds are released back to your bank automatically, usually within a day or two. Most applications end this way when an issue is heavily oversubscribed — the next one is a fresh draw.`;

  /**
   * The site's footer stars, rebuilt for email. The real ones are clip-path shapes on a CSS
   * animation, none of which survives a mail client — and Gmail strips inline SVG — so these
   * are glyphs in a fixed side column, varied in size and opacity to suggest the same drift.
   */
  const starColumn = (align: 'left' | 'right') => {
    const stars: [string, number, number][] = [
      ['✦', 13, 0.5],
      ['✧', 9, 0.3],
      ['✦', 17, 0.65],
      ['✧', 8, 0.22],
      ['✦', 11, 0.42],
      ['✧', 14, 0.3],
    ];
    return stars
      .map(
        ([glyph, size, alpha], i) => `<div style="font-size:${size}px;line-height:1.9;color:rgba(255,255,255,${alpha});text-align:${
          // Nudged alternately so the column does not read as a straight line.
          i % 2 === 0 ? align : align === 'left' ? 'right' : 'left'
        };">${glyph}</div>`,
      )
      .join('');
  };

  // Mirrors the site's footer plate. Gmail and Outlook ignore CSS gradients, so every blue
  // surface carries a solid bgcolor underneath and the gradient is a progressive enhancement.
  const PLATE_SOLID = '#1433d8';
  const PLATE_GRAD =
    'linear-gradient(170deg,#1f40ed 0%,#1433d8 42%,#0a24bd 100%)';

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <style>
    /* Gmail discards <body>, so these hang off the wrapper below instead. Kept minimal —
       most clients strip <style> too, which is why every rule that matters is inline. */
    html, body { margin:0 !important; padding:0 !important; width:100% !important; background:#0a24bd !important; }
    .plate-bg { background:#0a24bd !important; }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background:#0a24bd;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <!-- Gmail strips <body> and reparents the content, so the outermost surviving element has
       to carry the colour or the message renders on the client's own white. -->
  <div class="plate-bg" style="background:#0a24bd;margin:0;padding:0;width:100%;">
  <table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a24bd" class="plate-bg" style="background:#0a24bd;margin:0;padding:0;width:100%;border-collapse:collapse;">
    <tr><td align="center" bgcolor="#0a24bd" style="background:#0a24bd;padding:26px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border-radius:16px;overflow:hidden;">

        <!-- header: the footer plate -->
        <tr><td bgcolor="${PLATE_SOLID}" style="background:${PLATE_SOLID};background-image:${PLATE_GRAD};padding:22px 14px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="34" valign="top" style="width:34px;">${starColumn('left')}</td>
          <td valign="top" style="padding:4px 6px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            ${
              logoBuffer
                ? `<td style="padding-right:11px;vertical-align:middle;">
                     <img src="cid:${LOGO_CID}" width="32" height="32" alt=""
                          style="display:block;border-radius:8px;width:32px;height:32px;" />
                   </td>`
                : ''
            }
            <td style="vertical-align:middle;">
              <div style="font-size:16px;font-weight:700;letter-spacing:-.01em;color:#ffffff;">Nirantara IPO</div>
              <div style="font-size:12px;color:rgba(255,255,255,.62);margin-top:1px;">${esc(ipo.name)}</div>
            </td>
          </tr></table>

          <h1 style="margin:22px 0 8px;font-size:26px;line-height:1.2;color:#ffffff;letter-spacing:-.025em;font-weight:700;">
            ${won ? 'Congratulations' : 'Allotment results are out'}
          </h1>
          <p style="margin:0;font-size:14.5px;line-height:1.6;color:rgba(255,255,255,.78);">Hi ${esc(first)}, ${headline}</p>
          </td>
          <td width="34" valign="top" style="width:34px;">${starColumn('right')}</td>
         </tr></table>
        </td></tr>

        <!-- body -->
        <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:0 26px;">

          ${
            won
              ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                   <tr><td bgcolor="#e7f6ee" style="background:#e7f6ee;border-radius:12px;padding:17px 19px;">
                     <div style="font-size:11.5px;color:#12864c;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Total allotted</div>
                     <div style="font-size:27px;font-weight:700;color:#0d6b3d;margin-top:3px;">${num(summary.totalShares)} shares</div>
                     <div style="font-size:13px;color:#12864c;margin-top:2px;">Invested ${money(summary.totalAmount)}</div>
                   </td></tr>
                 </table>`
              : ''
          }

          <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.055em;color:#8b8b94;margin:26px 0 2px;">Your accounts</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${accountRows}</table>

          ${
            won && estGain !== null
              ? `<div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.055em;color:#8b8b94;margin:26px 0 4px;">If it lists at today's grey market premium</div>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                   ${row('Grey market premium', `₹${gmp} per share`)}
                   ${row('Estimated gain', `${estGain >= 0 ? '+' : ''}${money(estGain)}`, true)}
                   ${row('Estimated value on listing', money(listingValue ?? 0))}
                 </table>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:13px;">
                   <tr><td bgcolor="#fdf4e3" style="background:#fdf4e3;border-radius:9px;padding:12px 14px;font-size:12.5px;line-height:1.55;color:#7a4e08;">
                     Grey market premium is an unofficial signal that moves daily and is often wrong.
                     This is an estimate of what today's premium would be worth on your allotment —
                     not a prediction, and not advice on whether to sell or hold.
                   </td></tr>
                 </table>`
              : ''
          }

          <p style="margin:24px 0 0;font-size:14px;line-height:1.65;color:#52525b;">${closing}</p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 30px;">
            <tr><td bgcolor="${PLATE_SOLID}" style="background:${PLATE_SOLID};border-radius:9px;">
              <a href="https://www.nirantara.cloud/ipo/${esc(ipo.id)}"
                 style="display:inline-block;padding:13px 26px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">
                View full details
              </a>
            </td></tr>
          </table>

        </td></tr>

        <!-- footer: the plate again, closing the frame -->
        <tr><td bgcolor="${PLATE_SOLID}" style="background:${PLATE_SOLID};background-image:${PLATE_GRAD};padding:20px 14px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="34" valign="top" style="width:34px;">${starColumn('left')}</td>
          <td valign="top" style="padding:4px 6px;">
          <div style="font-size:15px;font-weight:700;color:rgba(255,255,255,.92);letter-spacing:-.01em;">NIRANTARA</div>
          <div style="font-size:11.5px;line-height:1.65;color:rgba(255,255,255,.6);margin-top:7px;">
            Sent because you track IPO allotments with Nirantara IPO. Manage alerts in the app under Alerts.<br>
            Nothing here is investment advice.
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,.45);margin-top:10px;">
            All rights reserved to Nirantara IPO · developed by stackeducation.in
          </div>
          </td>
          <td width="34" valign="top" style="width:34px;">${starColumn('right')}</td>
         </tr></table>
        </td></tr>

      </table>
    </td></tr>
  </table>
  </div>
</body></html>`;

  const text = [
    `${ipo.name} — allotment results`,
    '',
    `Hi ${first},`,
    won
      ? `You were allotted in ${summary.allottedAccounts} of ${summary.totalAccounts} accounts — ${num(summary.totalShares)} shares, ${money(summary.totalAmount)} invested.`
      : `No allotment this time across ${summary.totalAccounts} accounts.`,
    '',
    ...[...allotted, ...missed].map((r) =>
      r.status === 'allotted'
        ? `  ${r.label} (${r.panMasked}) — ${num(r.allottedQty ?? 0)} shares, ${money(r.amount ?? 0)}`
        : `  ${r.label} (${r.panMasked}) — not allotted`,
    ),
    ...(won && estGain !== null
      ? [
          '',
          `At today's grey market premium of Rs ${gmp}/share, that allotment would be worth about ${money(estGain)} on listing.`,
          `GMP is unofficial, moves daily and is often wrong. This is an estimate, not advice.`,
        ]
      : []),
    '',
    `https://www.nirantara.cloud/ipo/${ipo.id}`,
  ].join('\n');

  return { subject, html, text };
}

/** Sends the allotment result email. Never throws — a mail failure must not abort a sweep. */
export async function sendAllotmentEmail(
  accountId: string,
  ipo: IpoRow,
  summary: AllotmentSummary,
  gmp: number | null,
): Promise<boolean> {
  const t = mailer();
  if (!t) return false;

  const to = recipientFor(accountId);
  if (!to) return false;

  try {
    const { subject, html, text } = renderAllotmentEmail(to, ipo, summary, gmp);
    await t.sendMail({
      from: config.smtp.from,
      to: to.email,
      subject,
      html,
      text,
      // A reachable Reply-To and an unsubscribe header are two of the strongest signals a
      // mailbox uses to keep a message out of spam — cheap to add, meaningful for delivery.
      replyTo: config.smtp.user,
      headers: {
        'List-Unsubscribe': '<https://www.nirantara.cloud/alerts>',
        'X-Entity-Ref-ID': `${ipo.id}-${to.email}`,
      },
      attachments: logoBuffer
        ? [{ filename: 'logo.png', content: logoBuffer, cid: LOGO_CID, contentDisposition: 'inline' }]
        : [],
    });
    log.info(`allotment email sent for ${ipo.name}`);
    return true;
  } catch (err) {
    log.warn(`allotment email failed: ${(err as Error).message.split('\n')[0]}`);
    return false;
  }
}
