import { Router } from 'express';
import { db } from '../db/index.js';
import { getIpo, gmpHistory, latestGmp, listIpos, type IpoRow, type IpoStatus } from '../services/ipoStore.js';
import { listRegistrars } from '../registrars/index.js';
import { cacheGet } from '../util/cache.js';
import { daysBetween, todayIso } from '../util/parse.js';

export const iposRouter = Router();

/**
 * Whether the registrar has actually published the basis of allotment. The date-derived
 * status only says the allotment *window* has opened, which is why an issue whose results
 * are already out otherwise still reads as "awaiting".
 */
function allotmentIsLive(ipoId: string): boolean {
  const row = db.prepare('SELECT state FROM allotment_watch WHERE ipo_id = ?').get(ipoId) as
    | { state: string }
    | undefined;
  return row?.state === 'live' || row?.state === 'done';
}

function serialise(row: IpoRow) {
  const gmp = latestGmp(row.id);
  const today = todayIso();

  return {
    id: row.id,
    igId: row.ig_id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    exchange: row.exchange,
    status: row.status,
    priceText: row.price_text,
    priceMin: row.price_min,
    priceMax: row.price_max,
    lotSize: row.lot_size,
    /** What one lot actually costs at the cut-off price — the number retail applicants need. */
    lotAmount: row.lot_size && row.price_max ? row.lot_size * row.price_max : null,
    issueSize: row.issue_size,
    openDate: row.open_date,
    closeDate: row.close_date,
    boaDate: row.boa_date,
    listingDate: row.listing_date,
    logoUrl: row.logo_url,
    registrar: row.registrar_key,
    subscription: row.subscription_json ? JSON.parse(row.subscription_json) : null,
    gmp: gmp?.gmp ?? null,
    gmpPercent: gmp?.gmp_percent ?? null,
    estListingPrice: gmp?.est_listing ?? null,
    gmpUpdatedAt: gmp?.captured_at ?? null,
    daysToClose: row.close_date ? daysBetween(today, row.close_date) : null,
    daysToAllotment: row.boa_date ? daysBetween(today, row.boa_date) : null,
    /** True once the registrar is actually answering allotment queries for this issue. */
    allotmentLive: allotmentIsLive(row.id),
  };
}

// Every GET on this router returns the same bytes for all users — cache them so a spike of
// readers on allotment evening hits memory, not SQLite.
iposRouter.use(cacheGet(30));

iposRouter.get('/', (req, res) => {
  const status = req.query.status as IpoStatus | undefined;
  const category = req.query.category as string | undefined;
  const rows = listIpos({
    status: status && status !== ('all' as IpoStatus) ? status : undefined,
    category: category && category !== 'all' ? category : undefined,
  });
  res.json(rows.map(serialise));
});

/** Everything the home screen needs in one round trip. */
iposRouter.get('/dashboard', (_req, res) => {
  const all = listIpos();
  const by = (status: IpoStatus) => all.filter((i) => i.status === status).map(serialise);

  res.json({
    open: by('open'),
    upcoming: by('upcoming'),
    // Issues between close and listing are where allotment checking actually happens.
    awaitingAllotment: all
      .filter((i) => i.status === 'closed' || i.status === 'allotment')
      .map(serialise),
    recentlyListed: by('listed').slice(0, 10),
    updatedAt: new Date().toISOString(),
  });
});

iposRouter.get('/registrars', (_req, res) => {
  res.json(listRegistrars());
});

iposRouter.get('/:id', (req, res) => {
  const row = getIpo(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'IPO not found' });
    return;
  }
  res.json({ ...serialise(row), gmpHistory: gmpHistory(row.id) });
});

iposRouter.get('/:id/gmp', (req, res) => {
  const row = getIpo(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'IPO not found' });
    return;
  }
  res.json(gmpHistory(row.id, Number(req.query.limit ?? 120)));
});

/** Live GMP leaderboard, biggest premium first — the screen most users open first. */
iposRouter.get('/gmp/live', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT i.* FROM ipos i
       WHERE i.status IN ('open', 'upcoming', 'closed', 'allotment')
         AND i.ig_id NOT IN (SELECT ig_id FROM hidden_ipos)`,
    )
    .all() as IpoRow[];

  const items = rows
    .map(serialise)
    .filter((i) => i.gmp !== null)
    .sort((a, b) => (b.gmpPercent ?? 0) - (a.gmpPercent ?? 0));

  res.json(items);
});
