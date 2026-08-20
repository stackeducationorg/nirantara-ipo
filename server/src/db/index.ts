import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../util/logger.js';

const log = logger('db');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  sync_key      TEXT NOT NULL UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT,
  name          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per device/browser signed into an account. Auth is a bearer token; there are no
-- passwords, devices pair by entering the account's sync key.
CREATE TABLE IF NOT EXISTS device_tokens (
  token_hash   TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL DEFAULT 'web',
  label        TEXT,
  expo_token   TEXT,
  webpush_sub  TEXT,
  last_seen_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_device_account ON device_tokens(account_id);

-- The saved PAN book. pan_enc is AES-GCM ciphertext; pan_hash is an HMAC for dedupe only.
CREATE TABLE IF NOT EXISTS pans (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  pan_enc      TEXT NOT NULL,
  pan_hash     TEXT NOT NULL,
  holder_name  TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, pan_hash)
);
CREATE INDEX IF NOT EXISTS idx_pans_account ON pans(account_id);

CREATE TABLE IF NOT EXISTS ipos (
  id                 TEXT PRIMARY KEY,
  ig_id              INTEGER UNIQUE,
  name               TEXT NOT NULL,
  slug               TEXT,
  category           TEXT,              -- IPO (mainboard) | SME
  exchange           TEXT,
  status             TEXT,              -- upcoming | open | closed | allotment | listed
  price_text         TEXT,
  price_min          REAL,
  price_max          REAL,
  lot_size           INTEGER,
  issue_size         TEXT,
  open_date          TEXT,
  close_date         TEXT,
  boa_date           TEXT,              -- basis of allotment date
  listing_date       TEXT,
  logo_url           TEXT,
  registrar_key      TEXT,              -- adapter key: bigshare | kfintech | mufg | ...
  registrar_code     TEXT,              -- registrar's own company id for this issue
  registrar_synced_at TEXT,
  subscription_json  TEXT,
  raw_json           TEXT,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ipos_boa ON ipos(boa_date);
CREATE INDEX IF NOT EXISTS idx_ipos_status ON ipos(status);

CREATE TABLE IF NOT EXISTS gmp_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ipo_id       TEXT NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
  gmp          REAL,
  gmp_percent  REAL,
  est_listing  REAL,
  captured_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gmp_ipo_time ON gmp_history(ipo_id, captured_at DESC);

-- One row per (ipo, pan) check. Re-checking updates the row in place.
CREATE TABLE IF NOT EXISTS allotment_results (
  id            TEXT PRIMARY KEY,
  ipo_id        TEXT NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
  pan_id        TEXT NOT NULL REFERENCES pans(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,   -- allotted | not_allotted | not_applied | pending | error
  applied_qty   INTEGER,
  allotted_qty  INTEGER,
  amount        REAL,
  name_on_record TEXT,
  message       TEXT,
  raw_json      TEXT,
  checked_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (ipo_id, pan_id)
);
CREATE INDEX IF NOT EXISTS idx_alloc_account ON allotment_results(account_id, ipo_id);

-- Tracks whether an IPO's allotment has gone live on the registrar site, so the watcher
-- polls only until results appear and then stops.
CREATE TABLE IF NOT EXISTS allotment_watch (
  ipo_id        TEXT PRIMARY KEY REFERENCES ipos(id) ON DELETE CASCADE,
  state         TEXT NOT NULL DEFAULT 'waiting', -- waiting | live | done | unsupported
  attempts      INTEGER NOT NULL DEFAULT 0,
  went_live_at  TEXT,
  last_error    TEXT,
  last_attempt_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ipo_id      TEXT REFERENCES ipos(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data_json   TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_account ON notifications(account_id, created_at DESC);

-- Guards against re-sending the same lifecycle alert on every cron tick.
CREATE TABLE IF NOT EXISTS notification_log (
  dedupe_key  TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_prefs (
  account_id     TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  ipo_open       INTEGER NOT NULL DEFAULT 1,
  ipo_closing    INTEGER NOT NULL DEFAULT 1,
  allotment_out  INTEGER NOT NULL DEFAULT 1,
  listing_day    INTEGER NOT NULL DEFAULT 1,
  gmp_moves      INTEGER NOT NULL DEFAULT 1,
  gmp_threshold  REAL NOT NULL DEFAULT 10,
  only_watchlist INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS watchlist (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ipo_id      TEXT NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, ipo_id)
);

-- One row per (IPO, PAN) the user actually applied with. This is the money ledger: what was
-- blocked at application time, and what happened to it once allotment was published.
CREATE TABLE IF NOT EXISTS applications (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ipo_id           TEXT NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
  pan_id           TEXT NOT NULL REFERENCES pans(id) ON DELETE CASCADE,
  category         TEXT NOT NULL DEFAULT 'retail',   -- retail | shni | bhni
  lots             INTEGER NOT NULL DEFAULT 1,
  shares           INTEGER,        -- lots x lot size, frozen at application time
  amount_blocked   REAL,           -- shares x cut-off price: what the bank actually holds
  applied_at       TEXT NOT NULL DEFAULT (datetime('now')),
  -- Settlement, filled in once the registrar publishes allotment.
  allotted_shares  INTEGER,
  amount_debited   REAL,
  refund_amount    REAL,
  -- blocked -> funds still held; refund_pending -> allotment out, money not back yet;
  -- refund_received -> user confirmed it landed; debited -> fully allotted, nothing to refund.
  refund_status    TEXT NOT NULL DEFAULT 'blocked',
  settled_at       TEXT,
  notes            TEXT,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (ipo_id, pan_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_account ON applications(account_id, ipo_id);
CREATE INDEX IF NOT EXISTS idx_applications_refund ON applications(account_id, refund_status);
`);

/**
 * Adds a column to an existing table when it is missing. `CREATE TABLE IF NOT EXISTS` leaves
 * older databases untouched, so new columns need an explicit, idempotent migration.
 */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  log.info(`migrated: ${table}.${column} added`);
}

// A demat account is an alternative way to look up the same application, so it lives on the
// applicant's row rather than in a table of its own. Encrypted like the PAN.
addColumnIfMissing('pans', 'demat_enc', 'TEXT');
addColumnIfMissing('pans', 'demat_hash', 'TEXT');
addColumnIfMissing('pans', 'depository', 'TEXT');

addColumnIfMissing('accounts', 'email', 'TEXT');
addColumnIfMissing('accounts', 'password_hash', 'TEXT');
addColumnIfMissing('accounts', 'name', 'TEXT');
// Google's stable user id ("sub"). Kept alongside the email because a Google account's
// email can change, while the sub never does.
addColumnIfMissing('accounts', 'google_sub', 'TEXT');

// ALTER TABLE cannot add a UNIQUE column, so the constraint is a separate index.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email) WHERE email IS NOT NULL');
db.exec(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_google ON accounts(google_sub) WHERE google_sub IS NOT NULL',
);

log.info(`sqlite ready at ${config.dbPath}`);

/** Returns true the first time a given dedupe key is seen; false on every later call. */
export function claimOnce(dedupeKey: string): boolean {
  const res = db
    .prepare('INSERT OR IGNORE INTO notification_log (dedupe_key) VALUES (?)')
    .run(dedupeKey);
  return res.changes > 0;
}

/** Checks a dedupe key without claiming it — used to skip work that was already done. */
export function wasClaimed(dedupeKey: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM notification_log WHERE dedupe_key = ?').get(dedupeKey));
}
