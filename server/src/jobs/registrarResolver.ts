import { db } from '../db/index.js';
import { ensureRegistrar } from '../services/allotment.js';
import type { IpoRow } from '../services/ipoStore.js';
import { logger } from '../util/logger.js';

const log = logger('registrar-resolve');

/**
 * Roughly how long a registrar keeps a closed issue in its lookup dropdown.
 *
 * This is the whole reason this job exists. The company code an allotment lookup needs can
 * only be read out of that dropdown, so once an issue falls off it the code cannot be
 * recovered from anywhere — the issue is unresolvable permanently, not just for now.
 */
const DROPDOWN_GRACE_DAYS = 21;

/**
 * Issues whose registrar is still discoverable but has not been recorded yet.
 *
 * The allotment watcher resolves registrars too, but only for issues whose basis of allotment
 * has already passed and which listed within the last three days. That is a window of days,
 * and anything ingested outside it — a backfill, an outage during the window, a directory
 * entry that arrived late — never gets a registrar and, once the dropdown drops it, never
 * can. Resolving from the moment bidding opens closes the gap: the mapping is captured while
 * it is still obtainable, and ensureRegistrar persists it permanently.
 */
function unresolvedInReach(): IpoRow[] {
  return db
    .prepare(
      `SELECT * FROM ipos
       WHERE (registrar_key IS NULL OR registrar_code IS NULL)
         AND open_date IS NOT NULL
         AND date(open_date) <= date('now', '+1 day')
         AND (boa_date IS NULL OR date(boa_date) >= date('now', ?))
       ORDER BY open_date DESC`,
    )
    .all(`-${DROPDOWN_GRACE_DAYS} day`) as IpoRow[];
}

/**
 * Records the registrar for every issue that has one discoverable right now.
 *
 * Cheap despite the loop: resolveRegistrar reads each registrar's company list through a
 * 15-minute cache, so a batch of fifty issues still costs one dropdown fetch per registrar
 * rather than fifty.
 */
export async function resolveRegistrars(): Promise<void> {
  const pending = unresolvedInReach();
  if (pending.length === 0) return;

  log.info(`resolving registrar for ${pending.length} issue(s)`);
  let resolved = 0;

  for (const row of pending) {
    try {
      const ipo = await ensureRegistrar(row);
      if (ipo.registrar_key && ipo.registrar_code) resolved++;
    } catch (err) {
      // One unreachable registrar must not cost the rest of the batch.
      log.warn(`${row.name}: ${(err as Error).message.split('\n')[0]}`);
    }
  }

  log.info(`resolved ${resolved} of ${pending.length}`);
}
