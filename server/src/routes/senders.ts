import { Router } from 'express';
import { z } from 'zod';
import {
  addSender,
  listSenders,
  markSenderReturned,
  removeSender,
  senderSummary,
  updateSender,
} from '../services/senders.js';
import { requireAuth } from './auth.js';

export const sendersRouter = Router();
sendersRouter.use(requireAuth);

/**
 * One-time money senders: people who fund a single application rather than running their own
 * PANs across a dozen issues. Kept off /applications on purpose — nothing here has a PAN,
 * a lot count or an IPO, so it shares no shape with the ledger.
 */
sendersRouter.get('/', (req, res) => {
  res.json({ summary: senderSummary(req.accountId!), senders: listSenders(req.accountId!) });
});

const bodySchema = z.object({
  name: z.string().trim().min(1, 'A name is needed').max(60),
  amount: z.number().min(0).max(100_000_000),
  note: z.string().trim().max(200).nullable().optional(),
});

sendersRouter.post('/', (req, res) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid sender' });
    return;
  }
  res.json(addSender(req.accountId!, parsed.data));
});

sendersRouter.patch('/:id', (req, res) => {
  const parsed = bodySchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid sender' });
    return;
  }
  try {
    res.json(updateSender(req.accountId!, req.params.id, parsed.data));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

/** The whole point of the list: confirm their money went back, or undo a mis-tap. */
sendersRouter.post('/:id/returned', (req, res) => {
  const returned = (req.body ?? {}).returned !== false;
  try {
    res.json(markSenderReturned(req.accountId!, req.params.id, returned));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

sendersRouter.delete('/:id', (req, res) => {
  res.json({ ok: true, removed: removeSender(req.accountId!, req.params.id) });
});
