import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { getRegistrar, resolveRegistrar } from '../registrars/index.js';
import type { AllotmentStatus, CaptchaAnswer, DematAccount } from '../registrars/types.js';
import { CaptchaRequiredError } from '../registrars/types.js';
import { solveEnabled, solveImageCaptcha } from '../util/captchaSolver.js';
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
  message: string | null;
  checkedAt: string;
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

/** Checks a single PAN against the registrar and persists the outcome. */
async function checkOne(
  ipo: IpoRow,
  pan: PanRecord,
  captcha?: CaptchaAnswer | null,
): Promise<AllotmentResult> {
  const plainPan = pan.pan_enc ? decryptPan(pan.pan_enc) : null;
  const base = { panId: pan.id, label: pan.label, panMasked: maskIdentity(pan.pan_enc, pan.demat_enc) };
  const adapter = getRegistrar(ipo.registrar_key);

  let status: AllotmentStatus = 'pending';
  let appliedQty: number | null = null;
  let allottedQty: number | null = null;
  let nameOnRecord: string | null = null;
  let message: string | null = null;
  let raw: unknown = null;

  if (!adapter || !ipo.registrar_code) {
    status = 'pending';
    message = 'Registrar has not opened allotment lookup for this IPO yet';
  } else {
    // A demat account is a second way to reach the same application. Some registrars index
    // applications made through a broker by demat id and return nothing for the PAN, so a
    // PAN miss is retried by demat rather than reported as "not applied".
    const demat: DematAccount | null =
      pan.demat_enc && (pan.depository === 'NSDL' || pan.depository === 'CDSL')
        ? { depository: pan.depository, id: decryptPan(pan.demat_enc) }
        : null;

    const canUseDemat = Boolean(demat) && adapter.searchBy.includes('demat');

    if (!plainPan && !canUseDemat) {
      // Saved with only a demat account, against a registrar that cannot search by one.
      status = 'pending';
      message = `${adapter.name} can only search by PAN — add one to check this entry`;
    } else {
      try {
        // With no PAN there is nothing to try first, so go straight to the demat lookup.
        let lookup = await adapter.check({
          companyCode: ipo.registrar_code,
          pan: plainPan ?? '',
          demat,
          by: plainPan ? 'pan' : 'demat',
          captcha,
        });

        if (plainPan && lookup.status === 'not_applied' && canUseDemat) {
          const byDemat = await adapter.check({
            companyCode: ipo.registrar_code,
            pan: plainPan,
            demat,
            by: 'demat',
          });
          // Only take the demat answer if it actually found something.
          if (byDemat.status !== 'not_applied' && byDemat.status !== 'error') lookup = byDemat;
        }

        status = lookup.status;
        appliedQty = lookup.appliedQty ?? null;
        allottedQty = lookup.allottedQty ?? null;
        nameOnRecord = lookup.nameOnRecord ?? null;
        message = lookup.message ?? null;
        raw = lookup.raw ?? null;
      } catch (err) {
        // A captcha demand is not a failure to record — it must reach the caller so the UI
        // can show the challenge. Swallowing it here is what produced a wall of stored
        // "check failed" rows and no way to enter a captcha.
        if (err instanceof CaptchaRequiredError) throw err;
        status = 'error';
        message = (err as Error).message;
        log.warn(`check failed for ${pan.label} on ${ipo.name}: ${message}`);
      }
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

  // A captcha registrar cannot be checked without a human to read the challenge. In the
  // automatic sweep there is nobody, so attempting it every 10 minutes only hammers the
  // registrar's captcha endpoint into rate-limiting us (HTTP 429) and stores those as errors.
  // Skip it entirely on auto; the user's manual "check" is what solves it.
  if (adapter?.needsCaptcha && !opts.captcha && adapter.newCaptcha) {
    // If a solving service is configured, fetch the challenge and solve it via the service —
    // no human, works in the automatic sweep too. This is the "check by API" path: the image
    // goes to the solver, the text comes back, and the lookup proceeds like any other. One
    // solved token is then reused across the whole PAN book by the branch below.
    if (solveEnabled()) {
      const challenge = await adapter.newCaptcha();
      const solved = await solveImageCaptcha(challenge.image);
      if (solved.ok && solved.answer) {
        opts = { ...opts, captcha: { token: challenge.token, answer: solved.answer } };
      } else if (opts.auto) {
        // Solver failed and nobody is watching — leave it for the next sweep rather than error.
        return summarise(withRegistrar, []);
      } else {
        // Manual: hand the same challenge to the user so they can finish it themselves.
        throw new CaptchaRequiredError(challenge, 'Automatic solve failed — please enter the code');
      }
    } else if (opts.auto) {
      // No solver, automatic sweep: nobody to read it, so skip rather than hammer the endpoint.
      return summarise(withRegistrar, []);
    } else {
      // No solver, manual: fetch one challenge and surface it to the user.
      throw new CaptchaRequiredError(await adapter.newCaptcha(), 'This registrar requires a captcha');
    }
  }

  // Browser-driven registrars are serialised anyway; going wide only queues up timeouts.
  const concurrency = adapter?.driver === 'browser' ? 1 : 4;

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

/** Reads the last stored results without hitting the registrar. */
export function getStoredSummary(accountId: string, ipoId: string): AllotmentSummary | null {
  const ipo = getIpo(ipoId);
  if (!ipo) return null;

  const rows = db
    .prepare(
      `SELECT r.*, p.label, p.pan_enc, p.demat_enc
       FROM allotment_results r JOIN pans p ON p.id = r.pan_id
       WHERE r.account_id = ? AND r.ipo_id = ?`,
    )
    .all(accountId, ipoId) as (Record<string, unknown> & {
    label: string;
    pan_enc: string | null;
    demat_enc: string | null;
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
