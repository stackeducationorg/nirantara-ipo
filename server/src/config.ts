import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';

function optional(key: string, fallback = ''): string {
  return process.env[key]?.trim() || fallback;
}

/**
 * PANs are PII, so they are encrypted at rest with AES-256-GCM. In dev we fall back to a
 * key derived from the data directory so the app boots without setup, but a real deployment
 * must set PAN_ENCRYPTION_KEY (32 bytes, hex or base64) or restarts on a fresh host would
 * make existing rows undecryptable.
 */
function resolveEncryptionKey(dataDir: string): Buffer {
  const raw = optional('PAN_ENCRYPTION_KEY');
  if (raw) {
    const buf = raw.length === 64 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
      throw new Error('PAN_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars or 44 base64 chars)');
    }
    return buf;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PAN_ENCRYPTION_KEY is required in production');
  }
  return crypto.createHash('sha256').update(`niranthar-dev-key::${dataDir}`).digest();
}

const dataDir = path.resolve(optional('DATA_DIR', path.join(process.cwd(), 'data')));

export const config = {
  port: Number(optional('PORT', '4000')),
  dataDir,
  dbPath: path.join(dataDir, 'niranthar.db'),
  encryptionKey: resolveEncryptionKey(dataDir),

  /** Shared secret for /api/admin/* job triggers. Unset disables those routes entirely. */
  adminToken: optional('ADMIN_TOKEN'),

  /**
   * Mobile release gate. minVersion is the oldest build still permitted to run; raise it
   * only when an older client would actually misbehave, since it locks people out until
   * they install a new APK.
   */
  app: {
    minVersion: optional('APP_MIN_VERSION', '1.0.0'),
    latestVersion: optional('APP_LATEST_VERSION', '1.0.0'),
    downloadUrl: optional('APP_DOWNLOAD_URL', 'https://www.nirantara.cloud/download'),
    updateMessage: optional('APP_UPDATE_MESSAGE', ''),
  },

  /**
   * Transactional email. Empty credentials disable sending outright rather than failing
   * per-message, so a server without SMTP configured simply skips the email step.
   */
  smtp: {
    host: optional('SMTP_HOST', 'smtp.gmail.com'),
    port: Number(optional('SMTP_PORT', '465')),
    user: optional('SMTP_USER'),
    pass: optional('SMTP_PASS'),
    from: optional('SMTP_FROM', 'Nirantara IPO <stack.nirantaraipo@gmail.com>'),
  },

  // Google Sign-In. Empty disables the endpoint entirely rather than accepting
  // unverifiable tokens, so a missing value fails closed.
  googleClientId: optional('GOOGLE_CLIENT_ID'),

  /** Comma-separated origins allowed to call the API. Empty = allow all (dev). */
  corsOrigins: optional('CORS_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** Set false to boot the API without background cron jobs (useful for tests / CLI runs). */
  enableJobs: optional('ENABLE_JOBS', 'true') !== 'false',

  /** Playwright-backed registrars (KFin, MUFG) are slow and bot-walled; allow disabling them. */
  enableBrowserRegistrars: optional('ENABLE_BROWSER_REGISTRARS', 'true') !== 'false',
  browserHeadless: optional('BROWSER_HEADLESS', 'true') !== 'false',

  investorgain: {
    apiBase: 'https://webnodejs.investorgain.com/cloud/v2',
    siteBase: 'https://www.investorgain.com',
    /** Report ids discovered from the InvestorGain front-end bundle. */
    reports: { gmp: 331, calendar: 394, subscription: 333 },
  },

  push: {
    vapidPublicKey: optional('VAPID_PUBLIC_KEY'),
    vapidPrivateKey: optional('VAPID_PRIVATE_KEY'),
    vapidSubject: optional('VAPID_SUBJECT', 'mailto:admin@example.com'),
    expoAccessToken: optional('EXPO_ACCESS_TOKEN'),
  },

  /** How often the allotment watcher polls a registrar once an IPO reaches its BoA date. */
  allotmentPollCron: optional('ALLOTMENT_POLL_CRON', '*/10 * * * *'),
  gmpSyncCron: optional('GMP_SYNC_CRON', '*/15 * * * *'),
  ipoSyncCron: optional('IPO_SYNC_CRON', '0 */2 * * *'),
  lifecycleCron: optional('LIFECYCLE_CRON', '5 9,18 * * *'),
};

export type Config = typeof config;
