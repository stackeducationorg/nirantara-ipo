import { claimOnce, db } from '../db/index.js';
import { audienceForIpo, getPrefs, notify } from '../services/notify.js';
import { latestGmp, type IpoRow } from '../services/ipoStore.js';
import type { GmpChange } from '../services/ipoStore.js';
import { logger } from '../util/logger.js';
import { daysBetween, todayIso } from '../util/parse.js';

const log = logger('lifecycle');

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    value,
  );
}

function priceLine(ipo: IpoRow): string {
  const band = ipo.price_text ? `₹${ipo.price_text}` : 'price TBA';
  const lot = ipo.lot_size ? `, lot ${ipo.lot_size}` : '';
  const gmp = latestGmp(ipo.id);
  const gmpPart = gmp ? ` • GMP ₹${gmp.gmp}` : '';
  return `${band}${lot}${gmpPart}`;
}

async function fanOut(ipo: IpoRow, kind: Parameters<typeof notify>[0]['kind'], title: string, body: string) {
  await Promise.all(
    audienceForIpo(ipo.id).map((accountId) =>
      notify({ accountId, ipoId: ipo.id, kind, title, body, data: { ipoId: ipo.id } }),
    ),
  );
}

/**
 * Date-driven alerts: an issue opening, its last day to apply, and listing day. Each is
 * claimed once per IPO so re-running the cron never double-notifies.
 */
export async function runLifecycleAlerts(): Promise<void> {
  const today = todayIso();
  const ipos = db
    .prepare(
      `SELECT * FROM ipos
       WHERE open_date IS NOT NULL
         AND date(open_date, '-2 day') <= ?
         AND (listing_date IS NULL OR listing_date >= date(?, '-1 day'))`,
    )
    .all(today, today) as IpoRow[];

  for (const ipo of ipos) {
    try {
      if (ipo.open_date === today && claimOnce(`ipo_open:${ipo.id}`)) {
        await fanOut(ipo, 'ipo_open', `${ipo.name} IPO opens today`, `${priceLine(ipo)} • closes ${ipo.close_date ?? 'soon'}`);
      }

      if (ipo.close_date === today && claimOnce(`ipo_closing:${ipo.id}`)) {
        await fanOut(ipo, 'ipo_closing', `Last day: ${ipo.name}`, `Applications close today. ${priceLine(ipo)}`);
      }

      // A day-before nudge, since most retail applications go in on the final evening.
      if (ipo.close_date && daysBetween(today, ipo.close_date) === 1 && claimOnce(`ipo_closing_soon:${ipo.id}`)) {
        await fanOut(ipo, 'ipo_closing', `${ipo.name} closes tomorrow`, priceLine(ipo));
      }

      if (ipo.listing_date === today && claimOnce(`listing:${ipo.id}`)) {
        const gmp = latestGmp(ipo.id);
        const expectation = gmp?.est_listing ? ` Expected around ${money(gmp.est_listing)}.` : '';
        await fanOut(ipo, 'listing_day', `${ipo.name} lists today`, `Listing on ${ipo.exchange ?? 'the exchange'}.${expectation}`);
      }
    } catch (err) {
      log.error(`lifecycle alert failed for ${ipo.name}: ${(err as Error).message}`);
    }
  }
}

/**
 * GMP alerts fire per account because the threshold is a per-account preference: someone
 * tracking a ₹5 SME premium wants a different trigger than someone watching a ₹300 mainboard.
 */
export async function runGmpAlerts(changes: GmpChange[]): Promise<void> {
  for (const change of changes) {
    if (change.previous === null) continue; // first ever sample is not a "move"

    const delta = change.current - change.previous;
    const absDelta = Math.abs(delta);
    if (absDelta < 0.5) continue;

    const ipo = db.prepare('SELECT * FROM ipos WHERE id = ?').get(change.ipoId) as IpoRow | undefined;
    if (!ipo || ipo.status === 'listed') continue;

    for (const accountId of audienceForIpo(change.ipoId)) {
      const threshold = getPrefs(accountId).gmp_threshold ?? 10;
      const movePercent = Math.abs(change.deltaPercent ?? 0);
      if (movePercent < threshold) continue;

      // Throttle to one GMP alert per IPO per account per day.
      if (!claimOnce(`gmp:${change.ipoId}:${accountId}:${todayIso()}`)) continue;

      const arrow = delta > 0 ? '▲' : '▼';
      await notify({
        accountId,
        ipoId: change.ipoId,
        kind: 'gmp_move',
        title: `${change.name} GMP ${arrow} ₹${change.current}`,
        body: `Moved from ₹${change.previous} to ₹${change.current} (${delta > 0 ? '+' : ''}${delta.toFixed(0)})${
          change.percent !== null ? ` • ${change.percent}% over issue price` : ''
        }`,
        data: { ipoId: change.ipoId, gmp: change.current, previous: change.previous },
      });
    }
  }
}
