import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from './auth.js';
import { encryptPan, hashPan } from '../util/crypto.js';
import { maskPan } from '../services/allotment.js';
import { decryptPan } from '../util/crypto.js';

export const pansRouter = Router();
pansRouter.use(requireAuth);

/** Structure of an Indian PAN: 5 letters, 4 digits, 1 letter. */
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * A demat account number identifies its depository by shape, so the user is not asked to
 * pick one: NSDL is "IN" plus 14 digits, CDSL is a bare 16 digits.
 */
function parseDemat(input: string): { id: string; depository: 'NSDL' | 'CDSL' } | null {
  const value = input.replace(/[\s-]/g, '').toUpperCase();
  if (/^IN[0-9]{14}$/.test(value)) return { id: value, depository: 'NSDL' };
  if (/^[0-9]{16}$/.test(value)) return { id: value, depository: 'CDSL' };
  return null;
}

const DEMAT_HELP = 'Demat number must be 16 digits (CDSL) or IN followed by 14 digits (NSDL)';

const dematField = z
  .string()
  .trim()
  .max(24)
  .nullable()
  .optional()
  .refine((v) => v === undefined || v === null || v === '' || parseDemat(v) !== null, DEMAT_HELP);

const createSchema = z.object({
  pan: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => PAN_RE.test(s), 'PAN must look like ABCDE1234F'),
  label: z.string().trim().min(1).max(40),
  holderName: z.string().trim().max(80).optional(),
  demat: dematField,
});

interface PanRow {
  id: string;
  label: string;
  pan_enc: string;
  demat_enc: string | null;
  depository: string | null;
  holder_name: string | null;
  is_active: number;
  created_at: string;
}

/** Leaves only enough of a demat number visible to tell two accounts apart. */
function maskDemat(id: string): string {
  return id.length < 6 ? '••••••' : `${id.slice(0, 4)}••••••${id.slice(-4)}`;
}

function serialise(row: PanRow) {
  return {
    id: row.id,
    label: row.label,
    pan: maskPan(decryptPan(row.pan_enc)),
    demat: row.demat_enc ? maskDemat(decryptPan(row.demat_enc)) : null,
    depository: row.depository,
    holderName: row.holder_name,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

pansRouter.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM pans WHERE account_id = ? ORDER BY created_at ASC')
    .all(req.accountId!) as PanRow[];
  res.json(rows.map(serialise));
});

pansRouter.post('/', (req, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
    return;
  }
  const { pan, label, holderName, demat } = parsed.data;
  const parsedDemat = demat ? parseDemat(demat) : null;

  const id = crypto.randomUUID();
  try {
    db.prepare(
      `INSERT INTO pans (id, account_id, label, pan_enc, pan_hash, holder_name, demat_enc, demat_hash, depository)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.accountId!,
      label,
      encryptPan(pan),
      hashPan(pan),
      holderName ?? null,
      parsedDemat ? encryptPan(parsedDemat.id) : null,
      parsedDemat ? hashPan(parsedDemat.id) : null,
      parsedDemat ? parsedDemat.depository : null,
    );
  } catch (err) {
    // The (account_id, pan_hash) unique index is what stops the same PAN being added twice.
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'That PAN is already saved on this account' });
      return;
    }
    throw err;
  }

  const row = db.prepare('SELECT * FROM pans WHERE id = ?').get(id) as PanRow;
  res.status(201).json(serialise(row));
});

const patchSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  holderName: z.string().trim().max(80).nullable().optional(),
  isActive: z.boolean().optional(),
  demat: dematField,
});

pansRouter.patch('/:id', (req, res) => {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
    return;
  }

  const row = db.prepare('SELECT * FROM pans WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId!) as
    | PanRow
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'PAN not found' });
    return;
  }

  const { label, holderName, isActive, demat } = parsed.data;
  // An empty string clears the demat account; omitting the field leaves it untouched.
  const parsedDemat = demat ? parseDemat(demat) : null;

  db.prepare(
    `UPDATE pans SET
       label       = COALESCE(?, label),
       holder_name = CASE WHEN ? THEN ? ELSE holder_name END,
       is_active   = COALESCE(?, is_active),
       demat_enc   = CASE WHEN ? THEN ? ELSE demat_enc END,
       demat_hash  = CASE WHEN ? THEN ? ELSE demat_hash END,
       depository  = CASE WHEN ? THEN ? ELSE depository END
     WHERE id = ?`,
  ).run(
    label ?? null,
    holderName !== undefined ? 1 : 0,
    holderName ?? null,
    isActive === undefined ? null : isActive ? 1 : 0,
    demat !== undefined ? 1 : 0,
    parsedDemat ? encryptPan(parsedDemat.id) : null,
    demat !== undefined ? 1 : 0,
    parsedDemat ? hashPan(parsedDemat.id) : null,
    demat !== undefined ? 1 : 0,
    parsedDemat ? parsedDemat.depository : null,
    row.id,
  );

  res.json(serialise(db.prepare('SELECT * FROM pans WHERE id = ?').get(row.id) as PanRow));
});

pansRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM pans WHERE id = ? AND account_id = ?').run(req.params.id, req.accountId!);
  if (result.changes === 0) {
    res.status(404).json({ error: 'PAN not found' });
    return;
  }
  res.json({ ok: true });
});
