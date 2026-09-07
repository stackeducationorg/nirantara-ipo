import crypto from 'node:crypto';
import { db } from '../db/index.js';

/**
 * The second kind of person on the money page.
 *
 * The regular applicant runs the same PANs across ten or fifteen issues, and `applications`
 * tracks every lot, block and refund for them. A one-time sender does none of that: they
 * hand over the amount for a single application once and want to know it came back. So the
 * record here is deliberately just a name, an amount, and a state — no PAN, no lots, no IPO.
 *
 * `holding`  the money is with us
 * `returned` it has gone back to them
 */
export type SenderStatus = 'holding' | 'returned';

export interface SenderRow {
  id: string;
  account_id: string;
  name: string;
  amount: number;
  note: string | null;
  status: SenderStatus;
  received_at: string;
  returned_at: string | null;
}

export interface SenderView {
  id: string;
  name: string;
  amount: number;
  note: string | null;
  status: SenderStatus;
  receivedAt: string;
  returnedAt: string | null;
}

function toView(row: SenderRow): SenderView {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    note: row.note,
    status: row.status,
    receivedAt: row.received_at,
    returnedAt: row.returned_at,
  };
}

function get(accountId: string, id: string): SenderRow {
  const row = db
    .prepare('SELECT * FROM one_time_senders WHERE id = ? AND account_id = ?')
    .get(id, accountId) as SenderRow | undefined;
  if (!row) throw new Error('Sender not found');
  return row;
}

/** Outstanding first, since those are the ones still owed money. */
export function listSenders(accountId: string): SenderView[] {
  const rows = db
    .prepare(
      `SELECT * FROM one_time_senders
        WHERE account_id = ?
        ORDER BY CASE status WHEN 'holding' THEN 0 ELSE 1 END,
                 COALESCE(returned_at, received_at) DESC`,
    )
    .all(accountId) as SenderRow[];
  return rows.map(toView);
}

export function addSender(
  accountId: string,
  input: { name: string; amount: number; note?: string | null },
): SenderView {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO one_time_senders (id, account_id, name, amount, note)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, accountId, input.name.trim(), input.amount, input.note?.trim() || null);
  return toView(get(accountId, id));
}

export function updateSender(
  accountId: string,
  id: string,
  input: { name?: string; amount?: number; note?: string | null },
): SenderView {
  const row = get(accountId, id);
  db.prepare('UPDATE one_time_senders SET name = ?, amount = ?, note = ? WHERE id = ?').run(
    input.name?.trim() || row.name,
    input.amount ?? row.amount,
    input.note === undefined ? row.note : input.note?.trim() || null,
    id,
  );
  return toView(get(accountId, id));
}

/**
 * The one action this list exists for. Reversible on purpose — marking the wrong row is the
 * likeliest mistake here, and nothing downstream depends on the timestamp.
 */
export function markSenderReturned(accountId: string, id: string, returned: boolean): SenderView {
  get(accountId, id);
  db.prepare('UPDATE one_time_senders SET status = ?, returned_at = ? WHERE id = ?').run(
    returned ? 'returned' : 'holding',
    returned ? new Date().toISOString() : null,
    id,
  );
  return toView(get(accountId, id));
}

export function removeSender(accountId: string, id: string): boolean {
  return (
    db.prepare('DELETE FROM one_time_senders WHERE id = ? AND account_id = ?').run(id, accountId).changes > 0
  );
}

export interface SenderSummary {
  /** Still held on their behalf. */
  holding: number;
  /** Confirmed sent back. */
  returned: number;
  holdingCount: number;
  returnedCount: number;
  senderCount: number;
}

export function senderSummary(accountId: string): SenderSummary {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'holding'  THEN amount ELSE 0 END), 0) AS holding,
         COALESCE(SUM(CASE WHEN status = 'returned' THEN amount ELSE 0 END), 0) AS returned,
         COALESCE(SUM(CASE WHEN status = 'holding'  THEN 1 ELSE 0 END), 0)      AS holding_count,
         COALESCE(SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END), 0)      AS returned_count,
         COUNT(*)                                                               AS total
       FROM one_time_senders WHERE account_id = ?`,
    )
    .get(accountId) as {
    holding: number;
    returned: number;
    holding_count: number;
    returned_count: number;
    total: number;
  };

  return {
    holding: row.holding,
    returned: row.returned,
    holdingCount: row.holding_count,
    returnedCount: row.returned_count,
    senderCount: row.total,
  };
}
