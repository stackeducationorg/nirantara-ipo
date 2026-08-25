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
          <div style="font-weight:600;font-size:14px;color:#09090b;">${esc(r.label)}</div>
          <div style="font-size:12px;color:#8b8b94;">${esc(r.panMasked)}${
            r.nameOnRecord ? ' · ' + esc(r.nameOnRecord) : ''
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

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f7;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">

        <tr><td style="padding:20px 26px;border-bottom:1px solid #ececf0;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            ${
              logoBuffer
                ? `<td style="padding-right:10px;vertical-align:middle;">
                     <img src="cid:${LOGO_CID}" width="30" height="30" alt=""
                          style="display:block;border-radius:7px;width:30px;height:30px;" />
                   </td>`
                : ''
            }
            <td style="vertical-align:middle;">
              <span style="font-size:15px;font-weight:700;letter-spacing:-.01em;color:#09090b;">Nirantara IPO</span>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:28px 26px 6px;">
          <div style="font-size:13px;color:#8b8b94;margin-bottom:6px;">${esc(ipo.name)}</div>
          <h1 style="margin:0 0 10px;font-size:24px;line-height:1.25;color:#09090b;letter-spacing:-.02em;">
            ${won ? 'Congratulations' : 'Allotment results are out'}
          </h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;">Hi ${esc(first)}, ${headline}</p>
        </td></tr>

        ${
          won
            ? `<tr><td style="padding:22px 26px 0;">
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                        style="background:#e7f6ee;border-radius:10px;padding:16px 18px;">
                   <tr><td>
                     <div style="font-size:12px;color:#12864c;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Total allotted</div>
                     <div style="font-size:26px;font-weight:700;color:#0d6b3d;margin-top:3px;">${num(summary.totalShares)} shares</div>
                     <div style="font-size:13px;color:#12864c;margin-top:2px;">Invested ${money(summary.totalAmount)}</div>
                   </td></tr>
                 </table>
               </td></tr>`
            : ''
        }

        <tr><td style="padding:22px 26px 0;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#8b8b94;margin-bottom:2px;">Your accounts</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${accountRows}</table>
        </td></tr>

        ${
          won && estGain !== null
            ? `<tr><td style="padding:24px 26px 0;">
                 <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#8b8b94;margin-bottom:6px;">If it lists at today's grey market premium</div>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                   ${row('Grey market premium', `₹${gmp} per share`)}
                   ${row('Estimated gain', `${estGain >= 0 ? '+' : ''}${money(estGain)}`, true)}
                   ${row('Estimated value on listing', money(listingValue ?? 0))}
                 </table>
                 <p style="margin:12px 0 0;padding:11px 13px;background:#fdf4e3;border-radius:8px;font-size:12.5px;line-height:1.55;color:#7a4e08;">
                   Grey market premium is an unofficial signal that moves daily and is often wrong.
                   This is an estimate of what today's premium would be worth on your allotment —
                   not a prediction, and not advice on whether to sell or hold.
                 </p>
               </td></tr>`
            : ''
        }

        <tr><td style="padding:22px 26px 0;">
          <p style="margin:0;font-size:14px;line-height:1.65;color:#52525b;">${closing}</p>
        </td></tr>

        <tr><td style="padding:24px 26px 30px;">
          <a href="https://www.nirantara.cloud/ipo/${esc(ipo.id)}"
             style="display:inline-block;background:#e0483d;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
            View full details
          </a>
        </td></tr>

        <tr><td style="padding:16px 26px 22px;border-top:1px solid #ececf0;background:#fafafa;">
          <div style="font-size:11.5px;line-height:1.6;color:#8b8b94;">
            Sent because you track IPO allotments with Nirantara IPO. Manage alerts in the app under Alerts.<br>
            Nothing here is investment advice. All rights reserved to Nirantara IPO · developed by stackeducation.in
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
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
