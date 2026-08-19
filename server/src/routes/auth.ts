import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  generateSyncKey,
  hashPassword,
  hashToken,
  randomToken,
  verifyPassword,
} from '../util/crypto.js';
import { logger } from '../util/logger.js';

const log = logger('auth');

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      accountId?: string;
      tokenHash?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    res.status(401).json({ error: 'Sign in to continue' });
    return;
  }

  const tokenHash = hashToken(token);
  const row = db.prepare('SELECT account_id FROM device_tokens WHERE token_hash = ?').get(tokenHash) as
    | { account_id: string }
    | undefined;

  if (!row) {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    return;
  }

  db.prepare(`UPDATE device_tokens SET last_seen_at = datetime('now') WHERE token_hash = ?`).run(tokenHash);
  req.accountId = row.account_id;
  req.tokenHash = tokenHash;
  next();
}

/**
 * Fixed-window limiter keyed by IP + route. Sign-in and sign-up are the endpoints worth
 * protecting: without this, an account's password is only as strong as the attacker's patience.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(maxAttempts: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = attempts.get(key);

    if (!entry || now > entry.resetAt) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > maxAttempts) {
      const seconds = Math.ceil((entry.resetAt - now) / 1000);
      res.status(429).json({ error: `Too many attempts. Try again in ${seconds}s.` });
      return;
    }
    next();
  };
}

// Drop expired windows periodically so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (now > entry.resetAt) attempts.delete(key);
}, 60_000).unref();

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  name: z.string().trim().min(1).max(80).optional(),
  platform: z.enum(['web', 'ios', 'android']).default('web'),
});

interface AccountRow {
  id: string;
  sync_key: string;
  email: string | null;
  password_hash: string | null;
  name: string | null;
  created_at: string;
}

function issueToken(accountId: string, platform: string, label?: string): string {
  const token = randomToken();
  db.prepare(
    `INSERT INTO device_tokens (token_hash, account_id, platform, label, last_seen_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run(hashToken(token), accountId, platform, label ?? null);
  return token;
}

function publicAccount(account: AccountRow) {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    syncKey: account.sync_key,
    createdAt: account.created_at,
  };
}

export const authRouter = Router();

authRouter.post('/register', rateLimit(5, 15 * 60_000), (req, res) => {
  const parsed = credentials.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid details' });
    return;
  }
  const { email, password, name, platform } = parsed.data;

  const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'An account with that email already exists' });
    return;
  }

  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO accounts (id, sync_key, email, password_hash, name) VALUES (?, ?, ?, ?, ?)',
  ).run(id, generateSyncKey(), email, hashPassword(password), name ?? null);
  db.prepare('INSERT INTO alert_prefs (account_id) VALUES (?)').run(id);

  const token = issueToken(id, platform);
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow;

  log.info(`registered ${email}`);
  res.status(201).json({ token, account: publicAccount(account) });
});

authRouter.post('/login', rateLimit(10, 15 * 60_000), (req, res) => {
  const parsed = credentials.omit({ name: true }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter your email and password' });
    return;
  }
  const { email, password, platform } = parsed.data;

  const account = db.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as AccountRow | undefined;

  // Same message and no early return, so a valid email cannot be distinguished from an invalid one.
  if (!account?.password_hash || !verifyPassword(password, account.password_hash)) {
    res.status(401).json({ error: 'Incorrect email or password' });
    return;
  }

  const token = issueToken(account.id, platform);
  res.json({ token, account: publicAccount(account) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.accountId!) as AccountRow;
  const devices = db.prepare('SELECT COUNT(*) AS n FROM device_tokens WHERE account_id = ?').get(
    req.accountId!,
  ) as { n: number };
  const pans = db.prepare('SELECT COUNT(*) AS n FROM pans WHERE account_id = ? AND is_active = 1').get(
    req.accountId!,
  ) as { n: number };

  res.json({ ...publicAccount(account), deviceCount: devices.n, panCount: pans.n });
});

authRouter.post('/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM device_tokens WHERE token_hash = ?').run(req.tokenHash!);
  res.json({ ok: true });
});

const changePassword = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(200),
});

authRouter.post('/change-password', requireAuth, rateLimit(5, 15 * 60_000), (req, res) => {
  const parsed = changePassword.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.accountId!) as AccountRow;
  if (!account.password_hash || !verifyPassword(parsed.data.currentPassword, account.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(
    hashPassword(parsed.data.newPassword),
    account.id,
  );
  // Changing a password signs every other device out; this one keeps its token.
  db.prepare('DELETE FROM device_tokens WHERE account_id = ? AND token_hash != ?').run(
    account.id,
    req.tokenHash!,
  );

  res.json({ ok: true });
});

/** Links a second device to an existing account using its sync key. */
authRouter.post('/pair', rateLimit(10, 15 * 60_000), (req, res) => {
  const parsed = z
    .object({
      syncKey: z.string().trim().min(4),
      platform: z.enum(['web', 'ios', 'android']).default('web'),
    })
    .safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a valid sync key' });
    return;
  }

  const account = db.prepare('SELECT * FROM accounts WHERE sync_key = ?').get(
    parsed.data.syncKey.toUpperCase(),
  ) as AccountRow | undefined;

  if (!account) {
    res.status(404).json({ error: 'No account found for that sync key' });
    return;
  }

  res.json({ token: issueToken(account.id, parsed.data.platform), account: publicAccount(account) });
});
