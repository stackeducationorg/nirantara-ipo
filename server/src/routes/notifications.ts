import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { getPrefs } from '../services/notify.js';
import { requireAuth } from './auth.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT n.*, i.name AS ipo_name, i.logo_url
       FROM notifications n LEFT JOIN ipos i ON i.id = n.ipo_id
       WHERE n.account_id = ?
       ORDER BY n.created_at DESC LIMIT 100`,
    )
    .all(req.accountId!) as Record<string, unknown>[];

  res.json(
    rows.map((r) => ({
      id: r.id,
      ipoId: r.ipo_id,
      ipoName: r.ipo_name,
      logoUrl: r.logo_url,
      kind: r.kind,
      title: r.title,
      body: r.body,
      data: r.data_json ? JSON.parse(String(r.data_json)) : null,
      readAt: r.read_at,
      createdAt: r.created_at,
    })),
  );
});

notificationsRouter.get('/unread-count', (req, res) => {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE account_id = ? AND read_at IS NULL')
    .get(req.accountId!) as { n: number };
  res.json({ count: row.n });
});

notificationsRouter.post('/read', (req, res) => {
  const id = (req.body ?? {}).id as string | undefined;
  if (id) {
    db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND account_id = ?`).run(
      id,
      req.accountId!,
    );
  } else {
    db.prepare(
      `UPDATE notifications SET read_at = datetime('now') WHERE account_id = ? AND read_at IS NULL`,
    ).run(req.accountId!);
  }
  res.json({ ok: true });
});

/** Attaches a push destination (Expo token or browser subscription) to the calling device. */
const pushSchema = z.object({
  expoToken: z.string().trim().min(10).optional(),
  webPushSubscription: z.unknown().optional(),
});

notificationsRouter.post('/register-push', (req, res) => {
  const parsed = pushSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid push registration' });
    return;
  }
  const { expoToken, webPushSubscription } = parsed.data;

  db.prepare(
    `UPDATE device_tokens SET
       expo_token  = COALESCE(?, expo_token),
       webpush_sub = COALESCE(?, webpush_sub)
     WHERE token_hash = ?`,
  ).run(
    expoToken ?? null,
    webPushSubscription ? JSON.stringify(webPushSubscription) : null,
    req.tokenHash!,
  );

  res.json({ ok: true });
});

/** Public VAPID key so the browser can build a push subscription. */
notificationsRouter.get('/vapid-key', (_req, res) => {
  res.json({ key: config.push.vapidPublicKey || null });
});

const prefsSchema = z.object({
  ipo_open: z.boolean().optional(),
  ipo_closing: z.boolean().optional(),
  allotment_out: z.boolean().optional(),
  listing_day: z.boolean().optional(),
  gmp_moves: z.boolean().optional(),
  only_watchlist: z.boolean().optional(),
  gmp_threshold: z.number().min(0).max(200).optional(),
});

notificationsRouter.get('/prefs', (req, res) => {
  res.json(getPrefs(req.accountId!));
});

notificationsRouter.put('/prefs', (req, res) => {
  const parsed = prefsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid preferences' });
    return;
  }

  getPrefs(req.accountId!); // ensures the row exists
  const patch = parsed.data;

  for (const [key, value] of Object.entries(patch)) {
    const stored = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    // Column names come from the schema's own key list, never from raw user input.
    db.prepare(`UPDATE alert_prefs SET ${key} = ? WHERE account_id = ?`).run(stored, req.accountId!);
  }

  res.json(getPrefs(req.accountId!));
});

export const watchlistRouter = Router();
watchlistRouter.use(requireAuth);

watchlistRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.status, i.logo_url, i.boa_date
       FROM watchlist w JOIN ipos i ON i.id = w.ipo_id
       WHERE w.account_id = ? ORDER BY w.created_at DESC`,
    )
    .all(req.accountId!);
  res.json(rows);
});

watchlistRouter.put('/:ipoId', (req, res) => {
  db.prepare('INSERT OR IGNORE INTO watchlist (account_id, ipo_id) VALUES (?, ?)').run(
    req.accountId!,
    req.params.ipoId,
  );
  res.json({ ok: true, watching: true });
});

watchlistRouter.delete('/:ipoId', (req, res) => {
  db.prepare('DELETE FROM watchlist WHERE account_id = ? AND ipo_id = ?').run(req.accountId!, req.params.ipoId);
  res.json({ ok: true, watching: false });
});
