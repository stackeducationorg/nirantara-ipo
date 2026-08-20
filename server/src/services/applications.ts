import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { logger } from '../util/logger.js';
import { decryptPan } from '../util/crypto.js';
import { maskIdentity } from './allotment.js';
import { getIpo, type IpoRow } from './ipoStore.js';

const log = logger('applications');

/**
 * What happened to the money that was blocked when the application went in.
 *
 * `blocked`         funds are held by the bank, allotment not out yet
 * `refund_pending`  allotment is out and some money is owed back, not confirmed received
 * `refund_received` the user confirmed the refund landed
 * `debited`         fully allotted, so the whole block was converted into shares
 */
export type RefundStatus = 'blocked' | 'refund_pending' | 'refund_received' | 'debited';

/** Investor category, which is what decides the minimum application size. */
export type ApplicationCategory = 'retail' | 'shni' | 'bhni';

export interface ApplicationRow {
  id: string;
  account_id: string;
  ipo_id: string;
  pan_id: string;
  category: ApplicationCategory;
  lots: number;
  shares: number | null;
  amount_blocked: number | null;
  applied_at: string;
  allotted_shares: number | null;
  amount_debited: number | null;
  refund_amount: number | null;
  refund_status: RefundStatus;
  settled_at: string | null;
  notes: string | null;
  updated_at: string;
}

type JoinedRow = ApplicationRow & {
  label: string;
  pan_enc: string | null;
  demat_enc: string | null;
  holder_name: string | null;
};

export interface ApplicationView {
  id: string;
  ipoId: string;
  panId: string;
  label: string;
  panMasked: string;
  holderName: string | null;
  category: ApplicationCategory;
  lots: number;
  shares: number | null;
  amountBlocked: number | null;
  appliedAt: string;
  allottedShares: number | null;
  amountDebited: number | null;
  refundAmount: number | null;
  refundStatus: RefundStatus;
  settledAt: string | null;
  notes: string | null;
}

/**
 * Applications are priced at the cut-off — the upper end of the band. That is the amount the
 * bank actually blocks, regardless of where the issue finally prices.
 */
function cutoffPrice(ipo: IpoRow): number | null {
  return ipo.price_max ?? ipo.price_min;
}

export function computeAmount(ipo: IpoRow, lots: number): { shares: number | null; amount: number | null } {
  const price = cutoffPrice(ipo);
  if (!ipo.lot_size || !price) return { shares: null, amount: null };
  const shares = ipo.lot_size * lots;
  return { shares, amount: shares * price };
}

function toView(row: JoinedRow): ApplicationView {
  return {
    id: row.id,
    ipoId: row.ipo_id,
    panId: row.pan_id,
    label: row.label,
    panMasked: maskIdentity(row.pan_enc, row.demat_enc),
    holderName: row.holder_name,
    category: row.category,
    lots: row.lots,
    shares: row.shares,
    amountBlocked: row.amount_blocked,
    appliedAt: row.applied_at,
    allottedShares: row.allotted_shares,
    amountDebited: row.amount_debited,
    refundAmount: row.refund_amount,
    refundStatus: row.refund_status,
    settledAt: row.settled_at,
    notes: row.notes,
  };
}

const SELECT_WITH_PAN = `
  SELECT a.*, p.label, p.pan_enc, p.demat_enc, p.holder_name
  FROM applications a JOIN pans p ON p.id = a.pan_id
`;

export function listApplications(accountId: string, ipoId: string): ApplicationView[] {
  const rows = db
    .prepare(`${SELECT_WITH_PAN} WHERE a.account_id = ? AND a.ipo_id = ? ORDER BY p.created_at ASC`)
    .all(accountId, ipoId) as JoinedRow[];
  return rows.map(toView);
}

/** Records or updates one PAN's application. `lots = 0` removes it. */
export function saveApplication(
  accountId: string,
  ipoId: string,
  panId: string,
  input: { lots: number; category?: ApplicationCategory; notes?: string | null },
): ApplicationView | null {
  const ipo = getIpo(ipoId);
  if (!ipo) throw new Error('IPO not found');

  const owns = db.prepare('SELECT 1 FROM pans WHERE id = ? AND account_id = ?').get(panId, accountId);
  if (!owns) throw new Error('PAN not found on this account');

  if (input.lots <= 0) {
    db.prepare('DELETE FROM applications WHERE account_id = ? AND ipo_id = ? AND pan_id = ?').run(
      accountId,
      ipoId,
      panId,
    );
    return null;
  }

  const { shares, amount } = computeAmount(ipo, input.lots);

  db.prepare(
    `INSERT INTO applications (id, account_id, ipo_id, pan_id, category, lots, shares, amount_blocked, notes)
     VALUES (@id, @account_id, @ipo_id, @pan_id, @category, @lots, @shares, @amount, @notes)
     ON CONFLICT(ipo_id, pan_id) DO UPDATE SET
       category       = excluded.category,
       lots           = excluded.lots,
       shares         = excluded.shares,
       amount_blocked = excluded.amount_blocked,
       notes          = COALESCE(excluded.notes, applications.notes),
       updated_at     = datetime('now')`,
  ).run({
    id: crypto.randomUUID(),
    account_id: accountId,
    ipo_id: ipoId,
    pan_id: panId,
    category: input.category ?? 'retail',
    lots: input.lots,
    shares,
    amount,
    notes: input.notes ?? null,
  });

  const row = db.prepare(`${SELECT_WITH_PAN} WHERE a.ipo_id = ? AND a.pan_id = ?`).get(ipoId, panId) as JoinedRow;
  return toView(row);
}

/** Applies the same lot count from every active PAN — the usual "apply from all accounts" case. */
export function applyAll(
  accountId: string,
  ipoId: string,
  lots: number,
  category: ApplicationCategory = 'retail',
): ApplicationView[] {
  const pans = db
    .prepare('SELECT id FROM pans WHERE account_id = ? AND is_active = 1')
    .all(accountId) as { id: string }[];

  const run = db.transaction(() => {
    for (const pan of pans) saveApplication(accountId, ipoId, pan.id, { lots, category });
  });
  run();

  return listApplications(accountId, ipoId);
}

export function markRefund(accountId: string, applicationId: string, received: boolean): ApplicationView {
  const row = db
    .prepare('SELECT * FROM applications WHERE id = ? AND account_id = ?')
    .get(applicationId, accountId) as ApplicationRow | undefined;
  if (!row) throw new Error('Application not found');

  // A fully-allotted application has nothing owed back, so there is no refund to confirm.
  if (row.refund_status === 'debited') {
    throw new Error('This application was fully allotted — no refund is due');
  }

  db.prepare(
    `UPDATE applications SET refund_status = ?, settled_at = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(received ? 'refund_received' : 'refund_pending', received ? new Date().toISOString() : null, applicationId);

  return toView(db.prepare(`${SELECT_WITH_PAN} WHERE a.id = ?`).get(applicationId) as JoinedRow);
}

/**
 * Reconciles the ledger against freshly-checked allotment results: how many shares were
 * allotted, how much of the block became a purchase, and how much is owed back.
 *
 * Runs after every allotment sweep, so the money view settles itself with no user action.
 */
export function reconcileFromAllotment(accountId: string, ipoId: string): number {
  const ipo = getIpo(ipoId);
  if (!ipo) return 0;

  const price = cutoffPrice(ipo);
  if (!price) return 0;

  const rows = db
    .prepare(
      `SELECT a.id, a.amount_blocked, a.refund_status, r.status AS result_status, r.allotted_qty
       FROM applications a
       JOIN allotment_results r ON r.ipo_id = a.ipo_id AND r.pan_id = a.pan_id
       WHERE a.account_id = ? AND a.ipo_id = ?`,
    )
    .all(accountId, ipoId) as {
    id: string;
    amount_blocked: number | null;
    refund_status: RefundStatus;
    result_status: string;
    allotted_qty: number | null;
  }[];

  const update = db.prepare(
    `UPDATE applications SET
       allotted_shares = ?, amount_debited = ?, refund_amount = ?, refund_status = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
  );

  let changed = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      // Only settle once the registrar has given a definitive answer.
      if (row.result_status !== 'allotted' && row.result_status !== 'not_allotted') continue;

      const allotted = row.result_status === 'allotted' ? (row.allotted_qty ?? 0) : 0;
      const debited = allotted * price;
      const blocked = row.amount_blocked ?? 0;
      const refund = Math.max(blocked - debited, 0);

      // A refund the user already confirmed must not be knocked back to pending by a re-check.
      const status: RefundStatus =
        refund <= 0 ? 'debited' : row.refund_status === 'refund_received' ? 'refund_received' : 'refund_pending';

      update.run(allotted, debited, refund, status, row.id);
      changed += 1;
    }
  });
  run();

  if (changed > 0) log.info(`reconciled ${changed} application(s) for ${ipo.name}`);
  return changed;
}

export interface MoneySummary {
  /** Held by the bank across issues whose allotment is not out yet. */
  totalBlocked: number;
  /** Owed back, not yet confirmed received. */
  refundPending: number;
  /** Confirmed returned. */
  refundReceived: number;
  /** Converted into shares. */
  totalInvested: number;
  applicationCount: number;
  ipoCount: number;
}

export function moneySummary(accountId: string): MoneySummary {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN refund_status = 'blocked' THEN amount_blocked ELSE 0 END), 0)        AS blocked,
         COALESCE(SUM(CASE WHEN refund_status = 'refund_pending' THEN refund_amount ELSE 0 END), 0)  AS pending,
         COALESCE(SUM(CASE WHEN refund_status = 'refund_received' THEN refund_amount ELSE 0 END), 0) AS received,
         COALESCE(SUM(COALESCE(amount_debited, 0)), 0)                                               AS invested,
         COUNT(*)                                                                                    AS applications,
         COUNT(DISTINCT ipo_id)                                                                      AS ipos
       FROM applications WHERE account_id = ?`,
    )
    .get(accountId) as {
    blocked: number;
    pending: number;
    received: number;
    invested: number;
    applications: number;
    ipos: number;
  };

  return {
    totalBlocked: row.blocked,
    refundPending: row.pending,
    refundReceived: row.received,
    totalInvested: row.invested,
    applicationCount: row.applications,
    ipoCount: row.ipos,
  };
}

export interface IpoMoneyRow {
  ipoId: string;
  ipoName: string;
  logoUrl: string | null;
  category: string | null;
  status: string | null;
  boaDate: string | null;
  listingDate: string | null;
  accounts: number;
  totalLots: number;
  amountBlocked: number;
  amountDebited: number;
  refundAmount: number;
  allottedShares: number;
  /** Least-settled status across the IPO's applications, for the list badge. */
  refundStatus: RefundStatus;
}

/** Per-IPO money rollup, newest first — the Money page's main list. */
export function moneyByIpo(accountId: string): IpoMoneyRow[] {
  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.logo_url, i.category, i.status, i.boa_date, i.listing_date,
              COUNT(*)                            AS accounts,
              COALESCE(SUM(a.lots), 0)            AS lots,
              COALESCE(SUM(a.amount_blocked), 0)  AS blocked,
              COALESCE(SUM(a.amount_debited), 0)  AS debited,
              COALESCE(SUM(a.refund_amount), 0)   AS refund,
              COALESCE(SUM(a.allotted_shares), 0) AS allotted,
              MIN(CASE a.refund_status
                    WHEN 'blocked' THEN 0
                    WHEN 'refund_pending' THEN 1
                    WHEN 'refund_received' THEN 2
                    ELSE 3 END)                   AS status_rank
       FROM applications a JOIN ipos i ON i.id = a.ipo_id
       WHERE a.account_id = ?
       GROUP BY i.id
       ORDER BY COALESCE(i.boa_date, i.close_date, '9999') DESC`,
    )
    .all(accountId) as Record<string, unknown>[];

  const RANK: RefundStatus[] = ['blocked', 'refund_pending', 'refund_received', 'debited'];

  return rows.map((r) => ({
    ipoId: String(r.id),
    ipoName: String(r.name),
    logoUrl: (r.logo_url as string) ?? null,
    category: (r.category as string) ?? null,
    status: (r.status as string) ?? null,
    boaDate: (r.boa_date as string) ?? null,
    listingDate: (r.listing_date as string) ?? null,
    accounts: Number(r.accounts),
    totalLots: Number(r.lots),
    amountBlocked: Number(r.blocked),
    amountDebited: Number(r.debited),
    refundAmount: Number(r.refund),
    allottedShares: Number(r.allotted),
    refundStatus: RANK[Number(r.status_rank)] ?? 'blocked',
  }));
}
