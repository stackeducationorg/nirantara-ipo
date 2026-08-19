import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { decryptPan } from '../util/crypto.js';
import { maskPan } from '../services/allotment.js';
import {
  applyAll,
  listApplications,
  markRefund,
  moneyByIpo,
  moneySummary,
  saveApplication,
} from '../services/applications.js';
import { getIpo } from '../services/ipoStore.js';
import { requireAuth } from './auth.js';

export const applicationsRouter = Router();
applicationsRouter.use(requireAuth);

const category = z.enum(['retail', 'shni', 'bhni']);

/** Portfolio totals for the Money page header. */
applicationsRouter.get('/summary', (req, res) => {
  res.json(moneySummary(req.accountId!));
});

/** Per-IPO rollup for the Money page list. */
applicationsRouter.get('/by-ipo', (req, res) => {
  res.json(moneyByIpo(req.accountId!));
});

/**
 * Every saved PAN for one IPO, each annotated with its application if one exists. This is what
 * the "apply from which accounts" panel renders, so PANs without an application still appear.
 */
applicationsRouter.get('/ipo/:ipoId', (req, res) => {
  const ipo = getIpo(req.params.ipoId);
  if (!ipo) {
    res.status(404).json({ error: 'IPO not found' });
    return;
  }

  const pans = db
    .prepare('SELECT id, label, pan_enc, holder_name FROM pans WHERE account_id = ? AND is_active = 1 ORDER BY created_at ASC')
    .all(req.accountId!) as { id: string; label: string; pan_enc: string; holder_name: string | null }[];

  const applications = listApplications(req.accountId!, req.params.ipoId);
  const byPan = new Map(applications.map((a) => [a.panId, a]));

  const price = ipo.price_max ?? ipo.price_min;

  res.json({
    ipoId: ipo.id,
    ipoName: ipo.name,
    lotSize: ipo.lot_size,
    cutoffPrice: price,
    amountPerLot: ipo.lot_size && price ? ipo.lot_size * price : null,
    status: ipo.status,
    boaDate: ipo.boa_date,
    accounts: pans.map((pan) => ({
      panId: pan.id,
      label: pan.label,
      panMasked: maskPan(decryptPan(pan.pan_enc)),
      holderName: pan.holder_name,
      application: byPan.get(pan.id) ?? null,
    })),
  });
});

const saveSchema = z.object({
  panId: z.string().min(1),
  lots: z.number().int().min(0).max(1000),
  category: category.optional(),
  notes: z.string().max(200).nullable().optional(),
});

applicationsRouter.put('/ipo/:ipoId', (req, res) => {
  const parsed = saveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid application' });
    return;
  }

  try {
    const result = saveApplication(req.accountId!, req.params.ipoId, parsed.data.panId, {
      lots: parsed.data.lots,
      category: parsed.data.category,
      notes: parsed.data.notes,
    });
    res.json({ application: result });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

const applyAllSchema = z.object({
  lots: z.number().int().min(0).max(1000),
  category: category.optional(),
});

applicationsRouter.post('/ipo/:ipoId/apply-all', (req, res) => {
  const parsed = applyAllSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid lot count' });
    return;
  }

  try {
    res.json(applyAll(req.accountId!, req.params.ipoId, parsed.data.lots, parsed.data.category));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

applicationsRouter.post('/:applicationId/refund', (req, res) => {
  const received = (req.body ?? {}).received !== false;
  try {
    res.json(markRefund(req.accountId!, req.params.applicationId, received));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
