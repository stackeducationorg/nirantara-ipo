import { claimOnce, db } from '../db/index.js';
import { getRegistrar } from '../registrars/index.js';
import type { CaptchaAnswer, CaptchaChallenge } from '../registrars/types.js';
import { CaptchaRequiredError } from '../registrars/types.js';
import { logger } from '../util/logger.js';
import { todayIso } from '../util/parse.js';
import {
  checkOne,
  ensureRegistrar,
  getStoredSummary,
  summaryHeadline,
  type PanRecord,
} from './allotment.js';
import { sendAllotmentEmail } from './email.js';
import { notify } from './notify.js';
import { getIpo, latestGmp, type IpoRow } from './ipoStore.js';

const log = logger('sweep');

/**
 * Operator-driven allotment sweep for captcha-gated registrars.
 *
 * Bigshare will not answer without a human reading its challenge, which leaves the unattended
 * watcher unable to finish a sweep (see allotmentWatcher). Rather than push that captcha onto
 * every user — most of whom simply never open the app and so never learn their result — the
 * operator solves it once here and the answer is spent on the whole book: every account's PANs
 * are checked, stored, and pushed out by notification and email.
 *
 * Nothing about the challenge itself is circumvented. A person reads each image, and if the
 * registrar spends a token after a single lookup then a person reads the next one too. All this
 * does is move the reading to someone willing to do it, and make each solve count for as many
 * applicants as the registrar allows.
 */

/** Statuses that count as a final answer — never re-queried, so a solve is never spent twice. */
const SETTLED = ['allotted', 'not_allotted', 'not_applied'] as const;
const SETTLED_SQL = SETTLED.map((s) => `'${s}'`).join(', ');

export interface SweepTarget {
  ipoId: string;
  ipoName: string;
  boaDate: string | null;
  registrarKey: string | null;
  registrarName: string | null;
  /** Applicants still without a final answer for this issue. */
  pending: number;
  /** Applicants already settled — these are skipped on every later sweep. */
  settled: number;
  /**
   * Roughly how many codes this issue will cost.
   *
   * Bigshare spends a solved code only when it returns an actual record; a PAN with no
   * application costs nothing and the same code carries on. So the bill is one code per real
   * applicant, not per PAN — an issue with 83 pending and nobody who applied clears on one.
   *
   * Counted from applications recorded in the app, so it is a floor: someone who applied
   * without recording it here still turns up as a record and still costs a code.
   */
  applicants: number;
}

/**
 * Issues that need an operator: past their allotment date, handled by a captcha registrar, and
 * still holding at least one unanswered applicant.
 */
export function sweepTargets(): SweepTarget[] {
  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.boa_date, i.registrar_key,
              SUM(CASE WHEN COALESCE(r.status, '') IN (${SETTLED_SQL}) THEN 0 ELSE 1 END) AS pending,
              SUM(CASE WHEN COALESCE(r.status, '') IN (${SETTLED_SQL}) THEN 1 ELSE 0 END) AS settled,
              SUM(CASE WHEN COALESCE(r.status, '') IN (${SETTLED_SQL}) THEN 0
                       WHEN EXISTS (SELECT 1 FROM applications a WHERE a.ipo_id = i.id AND a.pan_id = p.id)
                       THEN 1 ELSE 0 END) AS applicants
         FROM ipos i
         CROSS JOIN pans p
         LEFT JOIN allotment_results r ON r.pan_id = p.id AND r.ipo_id = i.id
        WHERE p.is_active = 1
          AND i.boa_date IS NOT NULL
          AND i.boa_date <= ?
          AND (i.listing_date IS NULL OR date(i.listing_date, '+3 day') >= ?)
        GROUP BY i.id
        ORDER BY i.boa_date DESC`,
    )
    .all(todayIso(), todayIso()) as {
    id: string;
    name: string;
    boa_date: string | null;
    registrar_key: string | null;
    pending: number;
    settled: number;
    applicants: number;
  }[];

  return rows.flatMap((row) => {
    const adapter = getRegistrar(row.registrar_key);
    // Only captcha registrars need a human here; everything else the watcher finishes alone.
    if (!adapter?.needsCaptcha) return [];
    if (row.pending === 0) return [];
    return [
      {
        ipoId: row.id,
        ipoName: row.name,
        boaDate: row.boa_date,
        registrarKey: row.registrar_key,
        registrarName: adapter.name,
        pending: Number(row.pending),
        settled: Number(row.settled),
        applicants: Number(row.applicants),
      },
    ];
  });
}

/** Applicants for one issue that still have no final answer, oldest account first. */
function unresolvedPans(ipoId: string): PanRecord[] {
  return db
    .prepare(
      `SELECT p.id, p.account_id, p.label, p.pan_enc, p.demat_enc, p.depository, p.holder_name
         FROM pans p
         LEFT JOIN allotment_results r ON r.pan_id = p.id AND r.ipo_id = ?
        WHERE p.is_active = 1
          AND COALESCE(r.status, '') NOT IN (${SETTLED_SQL})
        ORDER BY p.account_id, p.id`,
    )
    .all(ipoId) as PanRecord[];
}

function accountHasPending(ipoId: string, accountId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1
         FROM pans p
         LEFT JOIN allotment_results r ON r.pan_id = p.id AND r.ipo_id = ?
        WHERE p.is_active = 1
          AND p.account_id = ?
          AND COALESCE(r.status, '') NOT IN (${SETTLED_SQL})
        LIMIT 1`,
    )
    .get(ipoId, accountId);
  return Boolean(row);
}

/**
 * Tells one account its result, once. Shares the dedupe key the unattended watcher uses, so an
 * account can never be told twice regardless of which path got there first.
 */
async function deliver(ipo: IpoRow, accountId: string): Promise<boolean> {
  const summary = getStoredSummary(accountId, ipo.id);
  if (!summary) return false;

  if (!claimOnce(`allotment_result:${ipo.id}:${accountId}`)) return false;

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

  // Second channel, for anyone who never installed the app or declined notifications.
  await sendAllotmentEmail(accountId, ipo, summary, latestGmp(ipo.id)?.gmp ?? null);
  return true;
}

export interface SweepOutcome {
  ipoId: string;
  ipoName: string;
  /** Applicants looked up on this solve, before the token was refused. */
  checked: number;
  /** Applicants still waiting — each needs another solve. */
  remaining: number;
  /** Accounts told their result on this pass, by push and email. */
  notified: number;
  /** True when the token was spent before the book was finished. */
  tokenSpent: boolean;
  /** Ready to solve immediately when more remain, so the operator is never left waiting. */
  nextCaptcha?: CaptchaChallenge;
  done: boolean;
}

/**
 * Spends one solved challenge on as much of the book as the registrar allows.
 *
 * The token may be single-use or reusable — Bigshare does not document which, and it has
 * changed before. So this walks applicants until the registrar refuses, then stops and hands
 * back a fresh challenge. Every answer is persisted as it arrives, so a refusal halfway through
 * costs nothing: the next solve resumes exactly where this one stopped and never re-checks an
 * applicant that already has an answer.
 */
export async function sweepWithCaptcha(ipoId: string, captcha: CaptchaAnswer): Promise<SweepOutcome> {
  const found = getIpo(ipoId);
  if (!found) throw new Error('IPO not found');

  const ipo = await ensureRegistrar(found);
  const adapter = getRegistrar(ipo.registrar_key);
  if (!adapter) throw new Error('Registrar not resolved for this IPO yet');
  if (!adapter.needsCaptcha) {
    throw new Error(`${adapter.name} needs no captcha — the automatic watcher handles it`);
  }

  const pending = unresolvedPans(ipoId);
  const touched = new Set<string>();
  let checked = 0;
  let tokenSpent = false;

  for (const pan of pending) {
    try {
      await checkOne(ipo, pan, captcha);
      checked += 1;
      touched.add(pan.account_id);
    } catch (err) {
      // The registrar refused the token. Everything already checked is saved, so stop here
      // rather than burning the rest of the book against a token that is clearly spent.
      if (err instanceof CaptchaRequiredError) {
        tokenSpent = true;
        log.info(`${ipo.name}: token spent after ${checked} of ${pending.length}`);
        break;
      }
      throw err;
    }
  }

  // Only tell an account once its whole book is settled — a half-checked account would
  // otherwise be emailed "no allotment" while some of its PANs are still unread.
  let notified = 0;
  for (const accountId of touched) {
    if (accountHasPending(ipoId, accountId)) continue;
    if (await deliver(ipo, accountId)) notified += 1;
  }

  const remaining = unresolvedPans(ipoId).length;
  const done = remaining === 0;

  log.info(
    `${ipo.name}: checked ${checked}, notified ${notified}, ${remaining} applicant(s) still pending`,
  );

  return {
    ipoId: ipo.id,
    ipoName: ipo.name,
    checked,
    remaining,
    notified,
    tokenSpent,
    // Fetching the next challenge here saves the operator a round trip between solves.
    nextCaptcha: done ? undefined : await adapter.newCaptcha?.().catch(() => undefined),
    done,
  };
}

/** A fresh challenge for an issue, to start or resume a sweep. */
export async function sweepCaptcha(ipoId: string): Promise<{ registrar: string; captcha: CaptchaChallenge }> {
  const found = getIpo(ipoId);
  if (!found) throw new Error('IPO not found');

  const ipo = await ensureRegistrar(found);
  const adapter = getRegistrar(ipo.registrar_key);
  if (!adapter?.needsCaptcha || !adapter.newCaptcha) {
    throw new Error('This registrar does not use a captcha');
  }
  return { registrar: adapter.name, captcha: await adapter.newCaptcha() };
}
