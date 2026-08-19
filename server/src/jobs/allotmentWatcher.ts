import { claimOnce, db, wasClaimed } from '../db/index.js';
import { getRegistrar } from '../registrars/index.js';
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
import { getIpo, type IpoRow } from '../services/ipoStore.js';

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
 * Cheap liveness probe: ask the registrar about a single real PAN. Until the basis of
 * allotment is published the registrar answers "no records", so a definitive allotted or
 * not-allotted answer is the signal that results have gone live.
 */
async function resultsArePublished(ipo: IpoRow): Promise<boolean> {
  const adapter = getRegistrar(ipo.registrar_key);
  if (!adapter || !ipo.registrar_code) return false;

  const pan = db.prepare('SELECT pan_enc FROM pans WHERE is_active = 1 LIMIT 1').get() as
    | { pan_enc: string }
    | undefined;
  if (!pan) return false;

  const lookup = await adapter.check({ companyCode: ipo.registrar_code, pan: decryptPan(pan.pan_enc) });
  return lookup.status === 'allotted' || lookup.status === 'not_allotted';
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
  const accounts = accountsWithPans();
  let outstanding = 0;

  for (const accountId of accounts) {
    const key = `allotment_result:${ipo.id}:${accountId}`;
    if (wasClaimed(key)) continue;

    let summary: AllotmentSummary;
    try {
      summary = await checkAllotmentForAccount(accountId, ipo.id);
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
export async function forceCheck(accountId: string, ipoId: string): Promise<AllotmentSummary> {
  const ipo = getIpo(ipoId);
  if (!ipo) throw new Error('IPO not found');
  await ensureRegistrar(ipo);
  return checkAllotmentForAccount(accountId, ipoId);
}
