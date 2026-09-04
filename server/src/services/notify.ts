import crypto from 'node:crypto';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import webpush from 'web-push';
import { config } from '../config.js';
import { claimOnce, db } from '../db/index.js';
import { logger } from '../util/logger.js';

const log = logger('notify');

const expo = new Expo(
  config.push.expoAccessToken ? { accessToken: config.push.expoAccessToken } : {},
);

const webPushReady = Boolean(config.push.vapidPublicKey && config.push.vapidPrivateKey);
if (webPushReady) {
  webpush.setVapidDetails(
    config.push.vapidSubject,
    config.push.vapidPublicKey,
    config.push.vapidPrivateKey,
  );
} else {
  log.warn('VAPID keys not set — browser push disabled (in-app notifications still work)');
}

export type NotificationKind =
  | 'ipo_open'
  | 'ipo_closing'
  | 'allotment_out'
  | 'allotment_result'
  | 'listing_day'
  | 'gmp_move'
  | 'announcement';

export interface NotificationInput {
  accountId: string;
  ipoId?: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Maps a notification kind onto the account preference column that gates it. */
const PREF_COLUMN: Record<NotificationKind, string | null> = {
  ipo_open: 'ipo_open',
  ipo_closing: 'ipo_closing',
  allotment_out: 'allotment_out',
  allotment_result: 'allotment_out',
  listing_day: 'listing_day',
  gmp_move: 'gmp_moves',
  // Operator announcements are not IPO alerts, so no per-kind toggle gates them.
  announcement: null,
};

export function getPrefs(accountId: string) {
  const row = db.prepare('SELECT * FROM alert_prefs WHERE account_id = ?').get(accountId) as
    | Record<string, number>
    | undefined;

  if (row) return row;

  db.prepare('INSERT OR IGNORE INTO alert_prefs (account_id) VALUES (?)').run(accountId);
  return db.prepare('SELECT * FROM alert_prefs WHERE account_id = ?').get(accountId) as Record<string, number>;
}

function isEnabled(accountId: string, kind: NotificationKind): boolean {
  const column = PREF_COLUMN[kind];
  if (!column) return true;
  return Boolean(getPrefs(accountId)[column]);
}

interface DeviceRow {
  token_hash: string;
  expo_token: string | null;
  webpush_sub: string | null;
}

async function sendExpo(tokens: string[], input: NotificationInput): Promise<void> {
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (valid.length === 0) return;

  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    sound: 'default',
    title: input.title,
    body: input.body,
    data: { kind: input.kind, ipoId: input.ipoId ?? null, ...input.data },
    priority: 'high',
    channelId: 'default',
  }));

  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, i) => {
        // A DeviceNotRegistered ticket means the app was uninstalled — drop the token.
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          db.prepare('UPDATE device_tokens SET expo_token = NULL WHERE expo_token = ?').run(chunk[i].to as string);
        }
      });
    } catch (err) {
      log.warn(`expo push failed: ${(err as Error).message}`);
    }
  }
}

async function sendWebPush(subs: { hash: string; sub: string }[], input: NotificationInput): Promise<void> {
  if (!webPushReady) return;

  await Promise.all(
    subs.map(async ({ hash, sub }) => {
      try {
        await webpush.sendNotification(
          JSON.parse(sub),
          JSON.stringify({
            title: input.title,
            body: input.body,
            data: { kind: input.kind, ipoId: input.ipoId ?? null, ...input.data },
          }),
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 mean the browser subscription is permanently gone.
        if (status === 404 || status === 410) {
          db.prepare('UPDATE device_tokens SET webpush_sub = NULL WHERE token_hash = ?').run(hash);
        } else {
          log.warn(`web push failed: ${(err as Error).message}`);
        }
      }
    }),
  );
}

/**
 * Records a notification and fans it out to every device registered on the account.
 * The in-app record is always written so the bell icon is accurate even when push is
 * unavailable or the user declined the permission prompt.
 */
export async function notify(input: NotificationInput): Promise<boolean> {
  if (!isEnabled(input.accountId, input.kind)) return false;

  db.prepare(
    `INSERT INTO notifications (id, account_id, ipo_id, kind, title, body, data_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    input.accountId,
    input.ipoId ?? null,
    input.kind,
    input.title,
    input.body,
    input.data ? JSON.stringify(input.data) : null,
  );

  const devices = db
    .prepare(
      `SELECT token_hash, expo_token, webpush_sub FROM device_tokens
       WHERE account_id = ? AND (expo_token IS NOT NULL OR webpush_sub IS NOT NULL)`,
    )
    .all(input.accountId) as DeviceRow[];

  await Promise.all([
    sendExpo(devices.flatMap((d) => (d.expo_token ? [d.expo_token] : [])), input),
    sendWebPush(
      devices.flatMap((d) => (d.webpush_sub ? [{ hash: d.token_hash, sub: d.webpush_sub }] : [])),
      input,
    ),
  ]);

  log.info(`[${input.kind}] ${input.title} -> ${devices.length} device(s)`);
  return true;
}

/** Every account that has at least one PAN saved, i.e. everyone who could have applied. */
export function accountsWithPans(): string[] {
  return (db.prepare('SELECT DISTINCT account_id FROM pans WHERE is_active = 1').all() as {
    account_id: string;
  }[]).map((r) => r.account_id);
}

export function accountsWatching(ipoId: string): string[] {
  return (
    db.prepare('SELECT account_id FROM watchlist WHERE ipo_id = ?').all(ipoId) as { account_id: string }[]
  ).map((r) => r.account_id);
}

/**
 * Target audience for an IPO-level alert: everyone with PANs, unless they asked to be told
 * only about IPOs on their watchlist.
 */
export function audienceForIpo(ipoId: string): string[] {
  const watchers = new Set(accountsWatching(ipoId));
  return accountsWithPans().filter((id) => !getPrefs(id).only_watchlist || watchers.has(id));
}

export interface BroadcastInput {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Reserve this key before sending, so a retried or double-submitted trigger cannot fan out twice. */
  dedupeKey?: string;
  /** Count the audience and write nothing — used to check reach before a real send. */
  dryRun?: boolean;
}

export interface BroadcastResult {
  accounts: number;
  devices: number;
  expoTokens: number;
  webPushSubs: number;
  dryRun: boolean;
  /** False when dedupeKey was already spent, i.e. this exact broadcast had already gone out. */
  sent: boolean;
}

/**
 * Sends one message to the whole user base: an in-app record for every account plus a push to
 * every registered device.
 *
 * Deliberately separate from notify(), which fans out one account at a time. At the sizes this
 * has to survive, per-account sending would mean one Expo round trip per user; here every token
 * is collected first so the SDK can batch them into its own 100-message chunks, and the in-app
 * rows are written in a single transaction.
 *
 * There is no unsend. A broadcast reaches every phone that has the app installed, so callers
 * should pass dryRun first to see the reach, and a dedupeKey to make a retry safe.
 */
export async function broadcast(input: BroadcastInput): Promise<BroadcastResult> {
  const accounts = (db.prepare('SELECT id FROM accounts').all() as { id: string }[]).map((r) => r.id);
  const devices = db
    .prepare(
      `SELECT token_hash, expo_token, webpush_sub FROM device_tokens
       WHERE expo_token IS NOT NULL OR webpush_sub IS NOT NULL`,
    )
    .all() as DeviceRow[];

  const expoTokens = devices.flatMap((d) => (d.expo_token ? [d.expo_token] : []));
  const webSubs = devices.flatMap((d) => (d.webpush_sub ? [{ hash: d.token_hash, sub: d.webpush_sub }] : []));

  const tally = {
    accounts: accounts.length,
    devices: devices.length,
    expoTokens: expoTokens.length,
    webPushSubs: webSubs.length,
  };

  if (input.dryRun) {
    log.info(`[broadcast dry run] "${input.title}" would reach ${tally.accounts} account(s), ${tally.devices} device(s)`);
    return { ...tally, dryRun: true, sent: false };
  }

  // Claimed before anything is written, so a duplicate POST is a no-op rather than a second blast.
  if (input.dedupeKey && !claimOnce(`broadcast:${input.dedupeKey}`)) {
    log.warn(`broadcast "${input.dedupeKey}" already sent — ignoring repeat`);
    return { ...tally, dryRun: false, sent: false };
  }

  const insert = db.prepare(
    `INSERT INTO notifications (id, account_id, ipo_id, kind, title, body, data_json)
     VALUES (?, ?, NULL, 'announcement', ?, ?, ?)`,
  );
  const dataJson = input.data ? JSON.stringify(input.data) : null;
  db.transaction((ids: string[]) => {
    for (const accountId of ids) insert.run(crypto.randomUUID(), accountId, input.title, input.body, dataJson);
  })(accounts);

  const payload: NotificationInput = {
    accountId: '',
    kind: 'announcement',
    title: input.title,
    body: input.body,
    data: input.data,
  };

  await Promise.all([sendExpo(expoTokens, payload), sendWebPush(webSubs, payload)]);

  log.info(`[broadcast] "${input.title}" -> ${tally.accounts} account(s), ${tally.devices} device(s)`);
  return { ...tally, dryRun: false, sent: true };
}
