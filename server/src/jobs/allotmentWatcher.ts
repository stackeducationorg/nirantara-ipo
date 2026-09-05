import { claimOnce, db, wasClaimed } from '../db/index.js';
import { getRegistrar } from '../registrars/index.js';
import type { CaptchaAnswer } from '../registrars/types.js';
import { decryptPan } from '../util/crypto.js';
import { logger } from '../util/logger.js';
import { todayIso } from '../util/parse.js';
import {
  checkAllotmentForAccount,
  ensureRegistrar,
  summaryHeadline,
  type AllotmentSummary,
} from '../services/allotment.js';
import { accountsWithPans, audienceForIpo, notify } from '../services/notify.js';
import { getIpo, latestGmp, type IpoRow } from '../services/ipoStore.js';

import { sendAllotmentEmail } from '../services/email.js';
const log = logger('watcher');

function watchState(ipoId: string) {
  db.prepare('INSERT OR IGNORE INTO allotment_watch (ipo_id) VALUES (?)').run(ipoId);
  return db.prepare('SELECT * FROM allotment_watch WHERE ipo_id = ?').get(ipoId) as {
    ipo_id: string;
    state: 'waiting' | 'live' | 'done' | 'unsupported';
    attempts: number;
    went_live_at: string | null;
    last_error: string | null;
  };
}

function setWatch(ipoId: string, patch: { state?: string; error?: string | null; live?: boolean }) {
  db.prepare(
    `UPDATE allotment_watch SET
       state           = COALESCE(?, state),
       attempts        = attempts + 1,
       last_error      = ?,
       went_live_at    = CASE WHEN ? = 1 AND went_live_at IS NULL THEN datetime('now') ELSE went_live_at END,
       last_attempt_at = datetime('now')
     WHERE ipo_id = ?`,
  ).run(patch.state ?? null, patch.error ?? null, patch.live ? 1 : 0, ipoId);
}

/**
 * IPOs whose allotment date has arrived but whose results we have not finished collecting.
 * The window closes a few days after listing, by which point registrars pull the lookup form.
 */
function iposAwaitingAllotment(): IpoRow[] {
  const today = todayIso();
  return db
    .prepare(
      `SELECT i.* FROM ipos i
       LEFT JOIN allotment_watch w ON w.ipo_id = i.id
       WHERE i.boa_date IS NOT NULL
         AND i.boa_date <= ?
         AND (i.listing_date IS NULL OR date(i.listing_date, '+3 day') >= ?)
         AND COALESCE(w.state, 'waiting') NOT IN ('done', 'unsupported')
       ORDER BY i.boa_date DESC`,
    )
    .all(today, today) as IpoRow[];
}

/**
 * Decides whether the basis of allotment has actually been published.
 *
 * Three signals, cheapest and most definitive first. The subtlety is that "no records" from
 * the registrar is ambiguous — it means either the results are not out, or that person did
 * not apply — so no single PAN lookup can settle it. Applications are user-declared, so even
 * a PAN with a recorded application may never have actually applied.
 */
async function resultsArePublished(ipo: IpoRow): Promise<boolean> {
  const adapter = getRegistrar(ipo.registrar_key);
  if (!adapter || !ipo.registrar_code) return false;

  // 1. A definitive answer already recorded for this issue is proof the registrar is live.
  const settled = db
    .prepare(
      `SELECT 1 FROM allotment_results
        WHERE ipo_id = ? AND status IN ('allotted', 'not_allotted') LIMIT 1`,
    )
    .get(ipo.id);
  if (settled) return true;

  // 2. A company only appears in the registrar's own list once its allotment can be queried.
  const companies = await adapter.listCompanies().catch(() => []);
  if (companies.some((c) => c.code === ipo.registrar_code)) return true;

  // 3. Last resort: ask on behalf of a few PANs that claim to have applied. Several are
  //    tried because any one of them may simply not have applied after all.
  const applicants = db
    .prepare(
      `SELECT DISTINCT p.pan_enc
         FROM applications a JOIN pans p ON p.id = a.pan_id
        WHERE a.ipo_id = ? AND p.pan_enc IS NOT NULL AND p.is_active = 1
        LIMIT 3`,
    )
    .all(ipo.id) as { pan_enc: string }[];

  for (const applicant of applicants) {
    const lookup = await adapter
      .check({ companyCode: ipo.registrar_code, pan: decryptPan(applicant.pan_enc) })
      .catch(() => null);
    if (lookup && (lookup.status === 'allotted' || lookup.status === 'not_allotted')) return true;
  }

  return false;
}

/**
 * The core of what other trackers miss: as soon as an IPO's allotment goes live, every saved
 * PAN is checked automatically and the account is told how many of its applications were
 * allotted — without anyone opening the app.
 */
export async function watchAllotments(): Promise<void> {
  const pending = pendingIposSafe();
  if (pending.length === 0) return;

  log.info(`watching ${pending.length} IPO(s) in the allotment window`);

  for (const row of pending) {
    try {
      const ipo = await ensureRegistrar(row);

      if (!ipo.registrar_key || !ipo.registrar_code) {
        setWatch(ipo.id, { error: 'registrar not resolved yet' });
        continue;
      }

      const state = watchState(ipo.id);

      if (state.state !== 'live') {
        const live = await resultsArePublished(ipo).catch((err) => {
          setWatch(ipo.id, { error: (err as Error).message });
          return false;
        });

        if (!live) {
          setWatch(ipo.id, { state: 'waiting' });
          continue;
        }

        setWatch(ipo.id, { state: 'live', live: true, error: null });

        // Announce publication once, to everyone who might have applied.
        if (claimOnce(`allotment_out:${ipo.id}`)) {
          await Promise.all(
            audienceForIpo(ipo.id).map((accountId) =>
              notify({
                accountId,
                ipoId: ipo.id,
                kind: 'allotment_out',
                title: `${ipo.name} allotment is out`,
                body: 'Checking all your saved PANs now…',
                data: { ipoId: ipo.id },
              }),
            ),
          );
        }
      }

      await notifyAccounts(ipo);
    } catch (err) {
      log.error(`watch failed for ${row.name}: ${(err as Error).message}`);
      setWatch(row.id, { error: (err as Error).message });
    }
  }
}

/** Runs the full PAN sweep per account and pushes the aggregate result exactly once. */
async function notifyAccounts(ipo: IpoRow): Promise<void> {
  const adapter = getRegistrar(ipo.registrar_key);

  // A captcha-gated registrar (Bigshare, Cameo) can never be swept unattended — there is
  // nobody here to solve the challenge. Left as-is, the sweep below would retry every tick
  // forever with an empty result each time, `outstanding` would never reach 0, and the
  // account would simply never hear back after the initial "allotment is out" ping. Instead,
  // say once that the result is on its way and close the watch; the operator sweep delivers
  // the real figures later under its own dedupe key. Nothing is asked of the applicant —
  // they have no way to help, and the app tells them so.
  if (adapter?.needsCaptcha) {
    for (const accountId of audienceForIpo(ipo.id)) {
      const key = `allotment_manual:${ipo.id}:${accountId}`;
      if (!claimOnce(key)) continue;
      await notify({
        accountId,
        ipoId: ipo.id,
        kind: 'allotment_result',
        title: `${ipo.name} — allotment is out`,
        body: `Results are being collected for every account. We'll send yours the moment it lands.`,
        data: { ipoId: ipo.id, pendingSweep: true },
      });
    }
    setWatch(ipo.id, { state: 'done', error: null });
    log.info(`${ipo.name}: captcha-gated registrar — told accounts their result is coming, awaiting operator sweep`);
    return;
  }

  const accounts = accountsWithPans();
  let outstanding = 0;

  for (const accountId of accounts) {
    const key = `allotment_result:${ipo.id}:${accountId}`;
    if (wasClaimed(key)) continue;

    let summary: AllotmentSummary;
    try {
      summary = await checkAllotmentForAccount(accountId, ipo.id, { auto: true });
    } catch (err) {
      log.warn(`sweep failed for account ${accountId}: ${(err as Error).message}`);
      outstanding += 1;
      continue;
    }

    // Results can go live for some PANs before others; retry next tick rather than
    // reporting a half-finished sweep as final.
    if (!summary.resultsLive || summary.errorAccounts > 0) {
      outstanding += 1;
      continue;
    }

    if (!claimOnce(key)) continue;

    const gotSome = summary.allottedAccounts > 0;
    await notify({
      accountId,
      ipoId: ipo.id,
      kind: 'allotment_result',
      title: gotSome ? `🎉 Allotted in ${ipo.name}` : `${ipo.name} — no allotment`,
      body: summaryHeadline(summary),
      data: {
        ipoId: ipo.id,
        allotted: summary.allottedAccounts,
        total: summary.totalAccounts,
        shares: summary.totalShares,
        amount: summary.totalAmount,
      },
    });

    // Email is a separate channel from push: someone who never installed the app, or who
    // denied notification permission, still gets their result. Awaited but never throwing,
    // so a mail failure cannot abort the rest of the sweep.
    await sendAllotmentEmail(accountId, ipo, summary, latestGmp(ipo.id)?.gmp ?? null);
  }

  if (outstanding === 0) {
    setWatch(ipo.id, { state: 'done', error: null });
    log.info(`${ipo.name}: all accounts notified, watch closed`);
  }
}

// Small indirection so a malformed row cannot abort the whole sweep.
function pendingIposSafe(): IpoRow[] {
  try {
    return iposAwaitingAllotment();
  } catch (err) {
    log.error(`could not list pending IPOs: ${(err as Error).message}`);
    return [];
  }
}

/** Manual re-check used by the API when a user taps "check now". */
export async function forceCheck(
  accountId: string,
  ipoId: string,
  opts: { panId?: string; captcha?: CaptchaAnswer | null } = {},
): Promise<AllotmentSummary> {
  const ipo = getIpo(ipoId);
  if (!ipo) throw new Error('IPO not found');
  await ensureRegistrar(ipo);
  return checkAllotmentForAccount(accountId, ipoId, opts);
}
