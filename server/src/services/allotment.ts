import crypto from 'node:crypto';
import { db } from '../db/index.js';
import {
  allRoutesGated,
  getRegistrar,
  needsCaptchaFor,
  resolveRegistrar,
  searchRoutes,
} from '../registrars/index.js';
import type {
  AllotmentLookup,
  AllotmentStatus,
  CaptchaAnswer,
  DematAccount,
  SearchBy,
} from '../registrars/types.js';
import { CaptchaRequiredError } from '../registrars/types.js';
import { BSE_ROUTED_REGISTRARS, checkIpoViaBse } from '../sources/bse.js';
import { decryptPan } from '../util/crypto.js';
import { mapLimit } from '../util/http.js';
import { logger } from '../util/logger.js';
import { reconcileFromAllotment } from './applications.js';
import { getIpo, type IpoRow } from './ipoStore.js';

const log = logger('allotment');

export interface PanRecord {
  id: string;
  account_id: string;
  label: string;
  pan_enc: string | null;
  demat_enc: string | null;
  depository: string | null;
  holder_name: string | null;
}

export interface AllotmentResult {
  panId: string;
  label: string;
  panMasked: string;
  status: AllotmentStatus;
  appliedQty: number | null;
  allottedQty: number | null;
  amount: number | null;
  nameOnRecord: string | null;
  /** The name saved against this entry in the PAN book, if any. */
  holderName: string | null;
  /**
   * Who this entry belongs to: the name stored with the PAN, else the registrar's, else the
   * label. The stored name wins so the same person reads the same way on every issue — BSE
   * and "not applied" lookups return no name at all.
   */
  displayName: string;
  message: string | null;
  checkedAt: string;
}

function nameFields(
  nameOnRecord: string | null,
  holderName: string | null,
  label: string,
): Pick<AllotmentResult, 'holderName' | 'displayName'> {
  return { holderName, displayName: holderName ?? nameOnRecord ?? label };
}

export interface AllotmentSummary {
  ipoId: string;
  ipoName: string;
  registrar: string | null;
  totalAccounts: number;
  allottedAccounts: number;
  notAllottedAccounts: number;
  notAppliedAccounts: number;
  errorAccounts: number;
  totalShares: number;
  totalAmount: number;
  /** True when at least one PAN returned a real answer — i.e. results are published. */
  resultsLive: boolean;
  results: AllotmentResult[];
}

export function maskPan(pan: string): string {
  if (pan.length < 10) return '••••••••••';
  return `${pan.slice(0, 3)}••••${pan.slice(-3)}`;
}

/** Leaves only enough of a demat number visible to tell two accounts apart. */
export function maskDemat(id: string): string {
  return id.length < 6 ? '••••••' : `${id.slice(0, 4)}••••••${id.slice(-4)}`;
}

/**
 * The masked identifier to show for an applicant. An entry may be saved with a PAN, a demat
 * account, or both, so this falls back rather than assuming a PAN is present.
 */
export function maskIdentity(panEnc: string | null, dematEnc?: string | null): string {
  if (panEnc) return maskPan(decryptPan(panEnc));
  if (dematEnc) return maskDemat(decryptPan(dematEnc));
  return '••••••••••';
}

/**
 * Ensures we know which registrar handles this issue and what its internal company code is,
 * caching the answer on the IPO row. Re-resolves once a day while results are still pending,
 * because registrars only add an issue to their dropdown close to the allotment date.
 */
export async function ensureRegistrar(ipo: IpoRow): Promise<IpoRow> {
  const fresh =
    ipo.registrar_key &&
    ipo.registrar_code &&
    ipo.registrar_synced_at &&
    Date.now() - Date.parse(`${ipo.registrar_synced_at}Z`) < 24 * 3600_000;

  if (fresh) return ipo;

  const match = await resolveRegistrar(ipo.name, ipo.registrar_key);
  if (!match) {
    db.prepare(`UPDATE ipos SET registrar_synced_at = datetime('now') WHERE id = ?`).run(ipo.id);
    return getIpo(ipo.id) ?? ipo;
  }

  db.prepare(
    `UPDATE ipos SET registrar_key = ?, registrar_code = ?, registrar_synced_at = datetime('now') WHERE id = ?`,
  ).run(match.registrarKey, match.companyCode, ipo.id);

  return getIpo(ipo.id) ?? ipo;
}

/**
 * The identifier kinds a saved entry carries, newest-proof first.
 *
 * Read straight off the stored columns so it can be answered without decrypting anything —
 * the route planner only needs to know which identifiers exist, not what they are.
 */
function identifiersOn(pan: PanRecord): SearchBy[] {
  const available: SearchBy[] = [];
  if (pan.demat_enc && (pan.depository === 'NSDL' || pan.depository === 'CDSL')) available.push('demat');
  if (pan.pan_enc) available.push('pan');
  return available;
}

/** Preference order when more than one source answers for the same entry: a found result
 *  beats "no application", which beats an undecided/failed one. */
const LOOKUP_RANK: Record<AllotmentStatus, number> = {
  allotted: 0,
  not_allotted: 1,
  not_applied: 2,
  pending: 3,
  error: 4,
};

/** Picks the most informative lookup among candidates (e.g. BSE vs the registrar's own path). */
function pickBestLookup(candidates: AllotmentLookup[]): AllotmentLookup {
  return candidates.reduce((best, c) => (LOOKUP_RANK[c.status] < LOOKUP_RANK[best.status] ? c : best));
}

/** Whether this account recorded an application for this IPO in the app. Evidence that a
 *  "not allotted" answer is real rather than a non-applicant's empty record. */
function accountAppliedTo(accountId: string, ipoId: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM applications WHERE account_id = ? AND ipo_id = ? LIMIT 1').get(accountId, ipoId),
  );
}

const saveStmt = db.prepare(`
INSERT INTO allotment_results (
  id, ipo_id, pan_id, account_id, status, applied_qty, allotted_qty, amount,
  name_on_record, message, raw_json, checked_at
) VALUES (@id, @ipo_id, @pan_id, @account_id, @status, @applied_qty, @allotted_qty, @amount,
  @name_on_record, @message, @raw_json, datetime('now'))
ON CONFLICT(ipo_id, pan_id) DO UPDATE SET
  status         = excluded.status,
  applied_qty    = excluded.applied_qty,
  allotted_qty   = excluded.allotted_qty,
  amount         = excluded.amount,
  name_on_record = COALESCE(excluded.name_on_record, allotment_results.name_on_record),
  message        = excluded.message,
  raw_json       = excluded.raw_json,
  checked_at     = datetime('now')
`);

/**
 * Checks a single PAN against the registrar and persists the outcome.
 */
export async function checkOne(
  ipo: IpoRow,
  pan: PanRecord,
  captcha?: CaptchaAnswer | null,
): Promise<AllotmentResult> {
  const plainPan = pan.pan_enc ? decryptPan(pan.pan_enc) : null;
  const base = { panId: pan.id, label: pan.label, panMasked: maskIdentity(pan.pan_enc, pan.demat_enc) };
  const adapter = getRegistrar(ipo.registrar_key);

  // A demat account is a second way to reach the same application. Some registrars index
  // applications made through a broker by demat id and return nothing for the PAN.
  const demat: DematAccount | null =
    pan.demat_enc && (pan.depository === 'NSDL' || pan.depository === 'CDSL')
      ? { depository: pan.depository, id: decryptPan(pan.demat_enc) }
      : null;

  /**
   * Looks the entry up through the registrar's own adapter, trying its ungated identifiers
   * first and taking the first real answer. `ungatedOnly` drops captcha-gated routes entirely
   * — used as the BSE fallback, where a PAN search would demand a challenge nobody can answer.
   */
  const checkViaRegistrar = async (ungatedOnly: boolean): Promise<AllotmentLookup> => {
    let routes = searchRoutes(adapter!, identifiersOn(pan));
    if (ungatedOnly) routes = routes.filter((by) => !needsCaptchaFor(adapter!, by));
    if (routes.length === 0) {
      return {
        status: 'pending',
        message: plainPan
          ? `${adapter!.name} could not be checked without a captcha`
          : `${adapter!.name} can only search by PAN — add one to check this entry`,
      };
    }
    let found: AllotmentLookup | null = null;
    let fallback: AllotmentLookup | null = null;
    for (const by of routes) {
      const attempt = await adapter!.check({
        companyCode: ipo.registrar_code!,
        pan: plainPan ?? '',
        demat,
        by,
        // A solved challenge belongs only to the path that demanded one.
        captcha: needsCaptchaFor(adapter!, by) ? captcha : undefined,
      });
      if (attempt.status !== 'not_applied' && attempt.status !== 'error') {
        found = attempt;
        break;
      }
      // "not applied" from one identifier is not proof: a broker application is indexed by
      // demat and answers nothing for the PAN. Keep it only as the answer of last resort.
      if (!fallback || (fallback.status === 'error' && attempt.status === 'not_applied')) {
        fallback = attempt;
      }
    }
    return found ?? fallback!;
  };

  let lookup: AllotmentLookup = {
    status: 'pending',
    message: 'Registrar has not opened allotment lookup for this IPO yet',
  };

  if (adapter && ipo.registrar_code) {
    try {
      if (BSE_ROUTED_REGISTRARS.has(adapter.key)) {
        // Prefer BSE — it answers by PAN with no captcha. But BSE now intermittently blocks
        // server requests (Akamai "Access Denied"), so never depend on it alone: fall back to
        // the registrar's own ungated paths (demat / application) rather than leave the issue
        // unchecked. checkIpoViaBse returns null when BSE cannot answer — blocked, or not
        // listing the issue yet — and never throws, so the fallback always runs.
        const candidates: AllotmentLookup[] = [];
        if (plainPan) {
          const viaBse = await checkIpoViaBse(ipo.name, plainPan);
          if (viaBse) candidates.push(viaBse);
        }
        candidates.push(await checkViaRegistrar(true));
        lookup = pickBestLookup(candidates);
      } else {
        lookup = await checkViaRegistrar(false);
      }
    } catch (err) {
      // A captcha demand must reach the caller so the UI can show the challenge.
      if (err instanceof CaptchaRequiredError) throw err;
      lookup = { status: 'error', message: (err as Error).message };
      log.warn(`check failed for ${pan.label} on ${ipo.name}: ${lookup.message}`);
    }
  }

  let status: AllotmentStatus = lookup.status;
  let appliedQty: number | null = lookup.appliedQty ?? null;
  let allottedQty: number | null = lookup.allottedQty ?? null;
  let nameOnRecord: string | null = lookup.nameOnRecord ?? null;
  let message: string | null = lookup.message ?? null;
  let raw: unknown = lookup.raw ?? null;
  const applicationNo = lookup.applicationNo ?? null;

  // A registrar that answers a non-applicant with a zero/empty record reads as "not allotted",
  // which would then email the account about an IPO it never applied to. Only trust
  // "not allotted" when there is evidence of a real application: a bid quantity, an application
  // number, or an application the user recorded. Otherwise it is really "no application found",
  // which never triggers a result notification.
  if (status === 'not_allotted') {
    const applied =
      (appliedQty ?? 0) > 0 || Boolean(applicationNo) || accountAppliedTo(pan.account_id, ipo.id);
    if (!applied) {
      status = 'not_applied';
      message = message ?? 'No application found';
    }
  }

  if (status === 'error') {
    // A retry that fails transiently (timeout, temporary block) must not erase a result
    // already confirmed by an earlier successful check — keep the last known-good answer.
    const previous = db
      .prepare(
        `SELECT status, applied_qty, allotted_qty, amount, name_on_record, message
         FROM allotment_results WHERE ipo_id = ? AND pan_id = ?`,
      )
      .get(ipo.id, pan.id) as
      | {
          status: AllotmentStatus;
          applied_qty: number | null;
          allotted_qty: number | null;
          amount: number | null;
          name_on_record: string | null;
          message: string | null;
        }
      | undefined;

    if (previous && previous.status !== 'error' && previous.status !== 'pending') {
      status = previous.status;
      appliedQty = previous.applied_qty;
      allottedQty = previous.allotted_qty;
      nameOnRecord = previous.name_on_record ?? nameOnRecord;
      message = previous.message;
    }
  }

  // Allotments are made at the cut-off price, so the upper end of the band is the right basis.
  const unitPrice = ipo.price_max ?? ipo.price_min;
  const amount = allottedQty && unitPrice ? allottedQty * unitPrice : allottedQty ? 0 : null;

  saveStmt.run({
    id: crypto.randomUUID(),
    ipo_id: ipo.id,
    pan_id: pan.id,
    account_id: pan.account_id,
    status,
    applied_qty: appliedQty,
    allotted_qty: allottedQty,
    amount,
    name_on_record: nameOnRecord,
    message,
    raw_json: raw ? JSON.stringify(raw).slice(0, 4000) : null,
  });

  // The registrar knows the real name on the demat account; adopt it once so the PAN book
  // shows who each entry actually belongs to.
  if (nameOnRecord && !pan.holder_name) {
    db.prepare('UPDATE pans SET holder_name = ? WHERE id = ?').run(nameOnRecord, pan.id);
  }

  return {
    ...base,
    status,
    appliedQty,
    allottedQty,
    amount,
    nameOnRecord,
    ...nameFields(nameOnRecord, pan.holder_name ?? nameOnRecord, pan.label),
    message,
    checkedAt: new Date().toISOString(),
  };
}

function summarise(ipo: IpoRow, results: AllotmentResult[]): AllotmentSummary {
  const allotted = results.filter((r) => r.status === 'allotted');
  return {
    ipoId: ipo.id,
    ipoName: ipo.name,
    registrar: ipo.registrar_key,
    totalAccounts: results.length,
    allottedAccounts: allotted.length,
    notAllottedAccounts: results.filter((r) => r.status === 'not_allotted').length,
    notAppliedAccounts: results.filter((r) => r.status === 'not_applied').length,
    errorAccounts: results.filter((r) => r.status === 'error').length,
    totalShares: allotted.reduce((sum, r) => sum + (r.allottedQty ?? 0), 0),
    totalAmount: allotted.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    // "not_applied" alone is ambiguous before publication, so it does not count as live.
    resultsLive: results.some((r) => r.status === 'allotted' || r.status === 'not_allotted'),
    results,
  };
}

export function getPans(accountId: string): PanRecord[] {
  return db
    .prepare(
      'SELECT id, account_id, label, pan_enc, demat_enc, depository, holder_name FROM pans WHERE account_id = ? AND is_active = 1',
    )
    .all(accountId) as PanRecord[];
}

/**
 * Checks every saved PAN for an account against one IPO. This is the gap the user hit in other
 * apps: instead of typing one PAN at a time, every account is checked in a single pass and
 * reported as an aggregate.
 */
export async function checkAllotmentForAccount(
  accountId: string,
  ipoId: string,
  opts: { panId?: string; captcha?: CaptchaAnswer | null; auto?: boolean } = {},
): Promise<AllotmentSummary> {
  const ipo = getIpo(ipoId);
  if (!ipo) throw new Error('IPO not found');

  const pans = opts.panId ? getPans(accountId).filter((p) => p.id === opts.panId) : getPans(accountId);
  if (pans.length === 0) return summarise(ipo, []);

  const withRegistrar = await ensureRegistrar(ipo);
  const adapter = getRegistrar(withRegistrar.registrar_key);

  // Browser-driven registrars are serialised anyway; going wide only queues up timeouts.
  const concurrency = adapter?.driver === 'browser' ? 1 : 4;

  /**
   * The gate belongs to individual lookups, not to the registrar as a whole.
   *
   * This used to ask "does this registrar ever use a captcha?" and stop dead if so — which
   * put a challenge in front of the user before a single saved entry had been looked at, and
   * made the automatic sweep skip the registrar outright. An entry carrying a demat account
   * is answered through the registrar's own ungated path, so it needs no challenge and no
   * human; only entries with no open route left have to wait for one.
   *
   * A registrar routed through BSE is never gated here: checkOne answers it on BSE, so even a
   * PAN-only entry (whose only Bigshare route is the captcha-gated PAN search) needs no
   * challenge.
   */
  const routedToBse = adapter != null && BSE_ROUTED_REGISTRARS.has(adapter.key);
  const isGated = (p: PanRecord): boolean =>
    adapter != null && !routedToBse && allRoutesGated(adapter, identifiersOn(p));

  const gatedPans = opts.captcha ? [] : pans.filter(isGated);
  const openPans = opts.captcha ? pans : pans.filter((p) => !isGated(p));

  if (gatedPans.length > 0 && adapter?.newCaptcha) {
    // Answer everything that can be answered without a challenge first. checkOne persists
    // each row as it goes, so these results survive the throw below and are already on the
    // record by the time the user is asked for anything.
    const answered = await mapLimit(openPans, concurrency, (p) => checkOne(withRegistrar, p, null));

    if (opts.auto) {
      // Nobody is watching an automatic sweep, and minting a challenge per entry is what
      // walks the registrar into rate-limiting the whole batch (HTTP 429). Report what the
      // open routes produced and leave the gated entries for the user's manual check.
      if (answered.length > 0) reconcileFromAllotment(accountId, ipoId);
      return summarise(withRegistrar, answered);
    }

    // Manual, and something genuinely still needs a human: surface one challenge for it.
    if (answered.length > 0) reconcileFromAllotment(accountId, ipoId);
    throw new CaptchaRequiredError(
      await adapter.newCaptcha(),
      gatedPans.length === pans.length
        ? 'This registrar requires a captcha'
        : `Checked ${answered.length} of ${pans.length} entries. The remaining ${gatedPans.length} need a captcha.`,
    );
  }

  let results: AllotmentResult[];

  if (opts.captcha && pans.length > 1) {
    /**
     * One solved captcha, applied to the whole book.
     *
     * Asking per PAN meant twenty saved accounts needed twenty captchas, which nobody is
     * going to sit through. The registrar may or may not accept a token more than once —
     * it is not documented either way — so this tries, and the moment a reuse is refused
     * it stops and reports what it already has rather than burning the rest of the book on
     * a token that is clearly spent.
     *
     * Worst case is therefore the old behaviour: one PAN checked per solve. Best case is
     * one solve for all of them.
     */
    results = [];
    for (const pan of pans) {
      try {
        results.push(await checkOne(withRegistrar, pan, opts.captcha));
      } catch (err) {
        if (err instanceof CaptchaRequiredError) {
          log.info(`${withRegistrar.name}: captcha token spent after ${results.length} of ${pans.length}`);
          break;
        }
        throw err;
      }
    }
  } else {
    results = await mapLimit(pans, concurrency, (pan) => checkOne(withRegistrar, pan, opts.captcha));
  }

  // Settle the money ledger from these results so refunds appear without any user action.
  reconcileFromAllotment(accountId, ipoId);

  return summarise(withRegistrar, results);
}

/**
 * How many of an account's saved entries this registrar will not answer without a challenge.
 *
 * Lets the UI warn only when a challenge is genuinely coming, rather than on the registrar's
 * name alone — an account whose entries all carry a demat account never sees one.
 */
export function gatedEntryCount(accountId: string, ipo: IpoRow): { gated: number; total: number } {
  const adapter = getRegistrar(ipo.registrar_key);
  const pans = getPans(accountId);
  if (!adapter) return { gated: 0, total: pans.length };
  return {
    gated: pans.filter((p) => allRoutesGated(adapter, identifiersOn(p))).length,
    total: pans.length,
  };
}

export interface ManualResultInput {
  panId: string;
  status: Extract<AllotmentStatus, 'allotted' | 'not_allotted' | 'not_applied'>;
  /** Shares allotted. Required for 'allotted', ignored otherwise. */
  allottedQty?: number | null;
}

/**
 * Records an outcome the user read off NSE themselves.
 *
 * Captcha registrars will not answer the server, so for those issues this is the only way a
 * result ever enters the app. Without it the user learns their allotment on NSE and the app
 * stays blind: no history, no refund settled, nothing to show once NSE stops answering 10 days
 * after the issue closes. Stored results are kept indefinitely, so capturing it inside that
 * window is what makes the answer permanent.
 *
 * Written through the same statement and reconciliation the registrar path uses, so a manual
 * result behaves identically everywhere downstream. `message` records the provenance, so a
 * self-reported row is never mistaken for one the registrar confirmed.
 */
export function recordManualResults(
  accountId: string,
  ipoId: string,
  inputs: ManualResultInput[],
): number {
  const ipo = getIpo(ipoId);
  if (!ipo) throw new Error('IPO not found');

  // Only PANs this account actually owns — the pan ids arrive from the client.
  const owned = new Map(getPans(accountId).map((p) => [p.id, p]));

  let saved = 0;
  const run = db.transaction(() => {
    for (const input of inputs) {
      const pan = owned.get(input.panId);
      if (!pan) continue;

      const allotted = input.status === 'allotted' ? Math.max(0, Math.trunc(input.allottedQty ?? 0)) : 0;
      // "Allotted" with no share count would settle the ledger to zero, which reads as a loss.
      if (input.status === 'allotted' && allotted === 0) continue;

      saveStmt.run({
        id: crypto.randomUUID(),
        ipo_id: ipoId,
        pan_id: pan.id,
        account_id: accountId,
        status: input.status,
        applied_qty: null,
        allotted_qty: input.status === 'allotted' ? allotted : 0,
        amount: null,
        name_on_record: null,
        message: 'Recorded by the applicant from NSE',
        raw_json: null,
      });
      saved += 1;
    }
  });
  run();

  if (saved > 0) reconcileFromAllotment(accountId, ipoId);
  return saved;
}

/** Reads the last stored results without hitting the registrar. */
export function getStoredSummary(accountId: string, ipoId: string): AllotmentSummary | null {
  const ipo = getIpo(ipoId);
  if (!ipo) return null;

  const rows = db
    .prepare(
      `SELECT r.*, p.label, p.pan_enc, p.demat_enc, p.holder_name
       FROM allotment_results r JOIN pans p ON p.id = r.pan_id
       WHERE r.account_id = ? AND r.ipo_id = ?`,
    )
    .all(accountId, ipoId) as (Record<string, unknown> & {
    label: string;
    pan_enc: string | null;
    demat_enc: string | null;
    holder_name: string | null;
  })[];

  if (rows.length === 0) return null;

  const results: AllotmentResult[] = rows.map((row) => ({
    panId: String(row.pan_id),
    label: row.label,
    panMasked: maskIdentity(row.pan_enc, row.demat_enc),
    status: row.status as AllotmentStatus,
    appliedQty: (row.applied_qty as number) ?? null,
    allottedQty: (row.allotted_qty as number) ?? null,
    amount: (row.amount as number) ?? null,
    nameOnRecord: (row.name_on_record as string) ?? null,
    ...nameFields((row.name_on_record as string) ?? null, row.holder_name, row.label),
    message: (row.message as string) ?? null,
    checkedAt: String(row.checked_at),
  }));

  return summarise(ipo, results);
}

/** Formats the aggregate into the one-line headline used for push notifications. */
export function summaryHeadline(summary: AllotmentSummary): string {
  if (summary.totalAccounts === 0) return 'No PANs saved yet';
  if (summary.allottedAccounts === 0) {
    return `No allotment in any of your ${summary.totalAccounts} account${summary.totalAccounts > 1 ? 's' : ''}`;
  }

  const money = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(summary.totalAmount);

  return `${summary.allottedAccounts} of ${summary.totalAccounts} accounts allotted • ${summary.totalShares} shares • ${money}`;
}
