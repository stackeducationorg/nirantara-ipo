import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { fetchIpoDirectory, fetchIpoUniverse, fetchSubscriptions, type IgIpo } from '../sources/investorgain.js';
import { logger } from '../util/logger.js';
import { todayIso } from '../util/parse.js';

const log = logger('ipo-store');

export type IpoStatus = 'upcoming' | 'open' | 'closed' | 'allotment' | 'listed';

export interface IpoRow {
  id: string;
  ig_id: number | null;
  name: string;
  slug: string | null;
  category: string | null;
  exchange: string | null;
  status: IpoStatus | null;
  price_text: string | null;
  price_min: number | null;
  price_max: number | null;
  lot_size: number | null;
  issue_size: string | null;
  open_date: string | null;
  close_date: string | null;
  boa_date: string | null;
  listing_date: string | null;
  logo_url: string | null;
  registrar_key: string | null;
  registrar_code: string | null;
  registrar_synced_at: string | null;
  subscription_json: string | null;
  updated_at: string;
}

/** Derives lifecycle status from the issue's dates rather than trusting upstream text. */
export function deriveStatus(ipo: Pick<IgIpo, 'openDate' | 'closeDate' | 'boaDate' | 'listingDate'>): IpoStatus {
  const today = todayIso();
  const { openDate, closeDate, boaDate, listingDate } = ipo;

  if (listingDate && today >= listingDate) return 'listed';
  if (boaDate && today >= boaDate) return 'allotment';
  if (closeDate && today > closeDate) return 'closed';
  if (openDate && closeDate && today >= openDate && today <= closeDate) return 'open';
  if (openDate && today < openDate) return 'upcoming';
  return closeDate && today > closeDate ? 'closed' : 'upcoming';
}

const upsertStmt = db.prepare(`
INSERT INTO ipos (
  id, ig_id, name, slug, category, exchange, status, price_text, price_min, price_max,
  lot_size, issue_size, open_date, close_date, boa_date, listing_date, raw_json, updated_at
) VALUES (
  @id, @ig_id, @name, @slug, @category, @exchange, @status, @price_text, @price_min, @price_max,
  @lot_size, @issue_size, @open_date, @close_date, @boa_date, @listing_date, @raw_json, datetime('now')
)
ON CONFLICT(ig_id) DO UPDATE SET
  name         = excluded.name,
  slug         = COALESCE(excluded.slug, ipos.slug),
  category     = COALESCE(excluded.category, ipos.category),
  exchange     = COALESCE(excluded.exchange, ipos.exchange),
  status       = excluded.status,
  price_text   = COALESCE(excluded.price_text, ipos.price_text),
  price_min    = COALESCE(excluded.price_min, ipos.price_min),
  price_max    = COALESCE(excluded.price_max, ipos.price_max),
  lot_size     = COALESCE(excluded.lot_size, ipos.lot_size),
  issue_size   = COALESCE(excluded.issue_size, ipos.issue_size),
  open_date    = COALESCE(excluded.open_date, ipos.open_date),
  close_date   = COALESCE(excluded.close_date, ipos.close_date),
  boa_date     = COALESCE(excluded.boa_date, ipos.boa_date),
  listing_date = COALESCE(excluded.listing_date, ipos.listing_date),
  raw_json     = excluded.raw_json,
  updated_at   = datetime('now')
`);

const insertGmpStmt = db.prepare(
  `INSERT INTO gmp_history (ipo_id, gmp, gmp_percent, est_listing) VALUES (?, ?, ?, ?)`,
);
const latestGmpStmt = db.prepare(
  `SELECT gmp, gmp_percent FROM gmp_history WHERE ipo_id = ? ORDER BY captured_at DESC LIMIT 1`,
);

export interface GmpChange {
  ipoId: string;
  name: string;
  previous: number | null;
  current: number;
  percent: number | null;
  deltaPercent: number | null;
}

export interface SyncResult {
  total: number;
  gmpChanges: GmpChange[];
}

/**
 * Pulls the IPO universe from InvestorGain, upserts it, and appends a GMP sample whenever the
 * premium actually moved — sampling on every tick would bloat the history table with duplicates.
 */
export async function syncIpos(): Promise<SyncResult> {
  const [universe, directory] = await Promise.all([
    fetchIpoUniverse(),
    fetchIpoDirectory().catch((err) => {
      log.warn(`directory fetch failed: ${(err as Error).message}`);
      return [];
    }),
  ]);

  const logos = new Map(directory.map((d) => [d.id, d.logoUrl]));
  const gmpChanges: GmpChange[] = [];

  const run = db.transaction((items: IgIpo[]) => {
    for (const item of items) {
      const existing = db.prepare('SELECT id FROM ipos WHERE ig_id = ?').get(item.igId) as
        | { id: string }
        | undefined;
      const id = existing?.id ?? crypto.randomUUID();

      upsertStmt.run({
        id,
        ig_id: item.igId,
        name: item.name,
        slug: item.slug,
        category: item.category,
        exchange: item.exchange,
        status: deriveStatus(item),
        price_text: item.priceText || null,
        price_min: item.priceMin,
        price_max: item.priceMax,
        lot_size: item.lotSize,
        issue_size: item.issueSize,
        open_date: item.openDate,
        close_date: item.closeDate,
        boa_date: item.boaDate,
        listing_date: item.listingDate,
        raw_json: JSON.stringify(item.raw),
      });

      const logo = logos.get(item.igId);
      if (logo) db.prepare('UPDATE ipos SET logo_url = ? WHERE id = ?').run(logo, id);

      if (item.gmp !== null) {
        const prev = latestGmpStmt.get(id) as { gmp: number | null } | undefined;
        const previous = prev?.gmp ?? null;

        if (previous === null || Math.abs(previous - item.gmp) > 0.001) {
          const estListing = item.priceMax !== null ? item.priceMax + item.gmp : null;
          insertGmpStmt.run(id, item.gmp, item.gmpPercent, estListing);

          gmpChanges.push({
            ipoId: id,
            name: item.name,
            previous,
            current: item.gmp,
            percent: item.gmpPercent,
            deltaPercent:
              previous !== null && previous !== 0
                ? ((item.gmp - previous) / Math.abs(previous)) * 100
                : null,
          });
        }
      }
    }
  });

  run(universe);
  log.info(`synced ${universe.length} IPOs, ${gmpChanges.length} GMP moves`);
  return { total: universe.length, gmpChanges };
}

/** Refreshes live subscription figures for issues that are currently open. */
export async function syncSubscriptions(): Promise<number> {
  const subs = await fetchSubscriptions();
  const stmt = db.prepare('UPDATE ipos SET subscription_json = ? WHERE ig_id = ?');

  const run = db.transaction(() => {
    for (const sub of subs) stmt.run(JSON.stringify(sub), sub.igId);
  });
  run();

  log.info(`updated subscription data for ${subs.length} IPOs`);
  return subs.length;
}

/** Recomputes lifecycle status for every stored IPO — cheap, and dates roll over daily. */
export function refreshStatuses(): void {
  const rows = db.prepare('SELECT id, open_date, close_date, boa_date, listing_date FROM ipos').all() as {
    id: string;
    open_date: string | null;
    close_date: string | null;
    boa_date: string | null;
    listing_date: string | null;
  }[];

  const stmt = db.prepare('UPDATE ipos SET status = ? WHERE id = ?');
  const run = db.transaction(() => {
    for (const row of rows) {
      const status = deriveStatus({
        openDate: row.open_date,
        closeDate: row.close_date,
        boaDate: row.boa_date,
        listingDate: row.listing_date,
      });
      stmt.run(status, row.id);
    }
  });
  run();
}

export function getIpo(id: string): IpoRow | undefined {
  return db.prepare('SELECT * FROM ipos WHERE id = ?').get(id) as IpoRow | undefined;
}

export function listIpos(filter?: { status?: IpoStatus; category?: string }): IpoRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter?.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  if (filter?.category) {
    clauses.push('category = ?');
    params.push(filter.category);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT * FROM ipos ${where}
       ORDER BY COALESCE(open_date, close_date, '9999') DESC, name ASC`,
    )
    .all(...params) as IpoRow[];
}

export function gmpHistory(ipoId: string, limit = 120) {
  return db
    .prepare(
      `SELECT gmp, gmp_percent, est_listing, captured_at
       FROM gmp_history WHERE ipo_id = ? ORDER BY captured_at DESC LIMIT ?`,
    )
    .all(ipoId, limit)
    .reverse();
}

export function latestGmp(ipoId: string) {
  return db
    .prepare(
      `SELECT gmp, gmp_percent, est_listing, captured_at
       FROM gmp_history WHERE ipo_id = ? ORDER BY captured_at DESC LIMIT 1`,
    )
    .get(ipoId) as { gmp: number; gmp_percent: number | null; est_listing: number | null; captured_at: string } | undefined;
}
