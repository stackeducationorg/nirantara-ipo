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

const createSchema = z.object({
  pan: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => PAN_RE.test(s), 'PAN must look like ABCDE1234F'),
  label: z.string().trim().min(1).max(40),
  holderName: z.string().trim().max(80).optional(),
});

interface PanRow {
  id: string;
  label: string;
  pan_enc: string;
  holder_name: string | null;
  is_active: number;
  created_at: string;
}

function serialise(row: PanRow) {
  return {
    id: row.id,
    label: row.label,
    pan: maskPan(decryptPan(row.pan_enc)),
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
  const { pan, label, holderName } = parsed.data;

  const id = crypto.randomUUID();
  try {
    db.prepare(
      `INSERT INTO pans (id, account_id, label, pan_enc, pan_hash, holder_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, req.accountId!, label, encryptPan(pan), hashPan(pan), holderName ?? null);
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

  const { label, holderName, isActive } = parsed.data;
  db.prepare(
    `UPDATE pans SET
       label       = COALESCE(?, label),
       holder_name = CASE WHEN ? THEN ? ELSE holder_name END,
       is_active   = COALESCE(?, is_active)
     WHERE id = ?`,
  ).run(
    label ?? null,
    holderName !== undefined ? 1 : 0,
    holderName ?? null,
    isActive === undefined ? null : isActive ? 1 : 0,
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
