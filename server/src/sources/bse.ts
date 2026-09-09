import { getJson, HttpError } from '../util/http.js';
import { nameSimilarity, toInt } from '../util/parse.js';
import { logger } from '../util/logger.js';
import type { AllotmentLookup } from '../registrars/types.js';

const log = logger('bse');

/**
 * BSE's own public "Status of Issue Application" service.
 *
 * Every mainboard and SME issue that lists on BSE can be looked up here by PAN with no
 * captcha, cookie, token or session — the challenge on bseindia.com/investors/appli_check is
 * a client-side gate on the submit button; the data endpoints themselves are unauthenticated
 * (verified live). We use this so a Bigshare-registrar issue is answered without ever touching
 * Bigshare's captcha-gated endpoint.
 *
 * The only gate is an Akamai edge filter on request headers: a `bseindia.com` Referer plus a
 * browser User-Agent are required (getJson already sends a browser UA). Keep request rates low
 * and honour 429s — BSE intends this form to be driven at human speed, and could begin
 * enforcing the captcha server-side at any time, so callers must fail soft.
 */
const API = 'https://api.bseindia.com/BseIndiaAPI/api';
const REFERER = 'https://www.bseindia.com/investors/appli_check';
const ORIGIN = 'https://www.bseindia.com';

const HEADERS = {
  Referer: REFERER,
  Origin: ORIGIN,
  Accept: 'application/json, text/plain, */*',
};

/** The issue list changes slowly; the SPA itself caches it (server sends max-age=60). */
const LIST_TTL_MS = 15 * 60 * 1000;

/** Minimum name-match confidence to accept a BSE issue as the same one, and the margin the
 *  best match must beat the runner-up by — a wrong issue would show another company's result,
 *  so an ambiguous match is refused rather than guessed (as nseSymbols.ts does for tickers). */
const MIN_CONFIDENCE = 0.6;
const MIN_MARGIN = 0.15;

interface BseIssue {
  imId: string;
  name: string;
  symbol: string;
}

interface IssueListResponse {
  // The list endpoint returns a lowercase `table`; the status endpoint uses capitalised keys.
  table?: { IM_ID?: string | number; IPOName?: string; IPOSymbol?: string }[];
  Table?: { IM_ID?: string | number; IPOName?: string; IPOSymbol?: string }[];
}

interface StatusRow {
  [key: string]: unknown;
}

interface StatusResponse {
  Table?: StatusRow[];
  Table1?: StatusRow[];
  Table2?: StatusRow[];
}

let listCache: { at: number; items: BseIssue[] } | null = null;

/** Small backoff wrapper: request() retries 5xx/network, but BSE answers 429 when hurried. */
async function getJsonWithRateLimit<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await getJson<T>(url, { headers: HEADERS, timeoutMs: 20_000 });
    } catch (err) {
      if (err instanceof HttpError && err.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
  // Unreachable — the loop either returns or throws — but satisfies the type checker.
  throw new Error('BSE request retry exhausted');
}

/**
 * The equity issue list BSE currently answers application queries for. `IM_ID` is BSE's own
 * issue identifier — the registrar-company-code equivalent, opaque and unrelated to symbol or
 * scrip code, so the list is the only place to obtain it.
 */
export async function fetchBseIssues(): Promise<BseIssue[]> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.items;

  const json = await getJsonWithRateLimit<IssueListResponse>(`${API}/appli_check_ng/w?itype=BB`);
  const rows = json.table ?? json.Table ?? [];
  if (!Array.isArray(rows)) throw new Error('BSE returned an unexpected issue list');

  const items = rows.flatMap((row) => {
    const imId = String(row.IM_ID ?? '').trim();
    const name = (row.IPOName ?? '').trim();
    if (!imId || !name) return [];
    return [{ imId, name, symbol: (row.IPOSymbol ?? '').trim() }];
  });

  listCache = { at: Date.now(), items };
  log.info(`${items.length} equity issue(s) open for application status`);
  return items;
}

/** Clears the cached issue list so the next lookup re-fetches it. */
export function resetBseCache(): void {
  listCache = null;
}

/**
 * Maps an IPO name to BSE's `IM_ID`. Returns null when no issue is a confident match — BSE
 * only lists an issue for lookup close to its allotment date, so a miss usually means "not
 * open yet" rather than "wrong name".
 */
export async function resolveBseImId(ipoName: string): Promise<BseIssue | null> {
  const issues = await fetchBseIssues();

  let best: { issue: BseIssue; score: number } | null = null;
  let second = 0;
  for (const issue of issues) {
    const score = nameSimilarity(ipoName, issue.name);
    if (!best || score > best.score) {
      if (best) second = best.score;
      best = { issue, score };
    } else if (score > second) {
      second = score;
    }
  }

  if (!best || best.score < MIN_CONFIDENCE) return null;
  // A near-exact match is conclusive; otherwise demand a clear margin over the runner-up so a
  // pair of similarly-named issues is never resolved to the wrong one.
  if (best.score < 0.85 && best.score - second < MIN_MARGIN) {
    log.warn(`ambiguous BSE match for "${ipoName}" (${best.score.toFixed(2)} vs ${second.toFixed(2)}) — skipped`);
    return null;
  }

  log.info(`"${ipoName}" -> BSE #${best.issue.imId} ("${best.issue.name}", ${best.score.toFixed(2)})`);
  return best.issue;
}

function pick(row: StatusRow, keys: string[]): unknown {
  for (const key of keys) {
    const found = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
    if (found !== undefined && row[found] !== null && row[found] !== '') return row[found];
  }
  return undefined;
}

/**
 * Reads a BSE status response into the common lookup shape.
 *
 * `Table` is the bid/application row; `Table1` is the allotment detail. A row with IsData=1 and
 * an application number is a real bid; ARAD_ALLTDQTY carries the allotted quantity. An empty
 * `Table`, or IsData=0, means BSE has no application on record for this PAN on this issue.
 */
export function parseBseStatus(json: StatusResponse, expectedSymbol?: string): AllotmentLookup {
  const table = Array.isArray(json.Table) ? json.Table : [];
  const table1 = Array.isArray(json.Table1) ? json.Table1 : [];

  const row = table[0];
  if (!row) return { status: 'not_applied', message: 'No application found on BSE', raw: json };

  // BSE echoes the issue's own name/symbol on a no-match; when we know the symbol we meant,
  // this catches a stale or mismatched imId rather than silently reporting "not applied".
  const symbol = String(pick(row, ['IM_IPO_SYMBOL']) ?? '').trim();
  if (expectedSymbol && symbol && symbol.toUpperCase() !== expectedSymbol.toUpperCase()) {
    return { status: 'error', message: `BSE returned a different issue (${symbol})`, raw: json };
  }

  const isData = toInt(pick(row, ['IsData'])) ?? 0;
  const applicationNo = pick(row, ['OE_APPLICATIONNO']);
  const hasApplication = isData === 1 && Boolean(applicationNo && String(applicationNo).trim());

  if (!hasApplication) {
    return { status: 'not_applied', message: 'No application found on BSE', raw: json };
  }

  const allotRow = table1[0] ?? row;
  const allotted = toInt(pick(allotRow, ['ARAD_ALLTDQTY'])) ?? 0;
  const applied = toInt(pick(row, ['OE_QTY']));

  return {
    status: allotted > 0 ? 'allotted' : 'not_allotted',
    allottedQty: allotted,
    appliedQty: applied ?? null,
    applicationNo: applicationNo ? String(applicationNo).trim() : null,
    nameOnRecord: null,
    raw: json,
  };
}

/**
 * Looks up an application on BSE by PAN. `imId` comes from resolveBseImId. All three query
 * keys must be present even though appNo is left empty — omitting one is redirected to an
 * error page by BSE.
 */
export async function checkBseByPan(imId: string, pan: string, expectedSymbol?: string): Promise<AllotmentLookup> {
  const url = `${API}/GETIPOAPPLSTATUS_EQ_Live_ng/w?imId=${encodeURIComponent(imId)}&appNo=&panNo=${encodeURIComponent(pan.toUpperCase())}`;
  const json = await getJsonWithRateLimit<StatusResponse>(url);
  return parseBseStatus(json, expectedSymbol);
}

/**
 * The single entry point the allotment service uses for a Bigshare-registrar issue: find the
 * issue on BSE by name, then look it up by PAN. Returns null when BSE does not yet list the
 * issue, so the caller can report "not open yet" rather than a false "not applied".
 */
export async function checkIpoViaBse(ipoName: string, pan: string): Promise<AllotmentLookup | null> {
  const issue = await resolveBseImId(ipoName);
  if (!issue) return null;
  return checkBseByPan(issue.imId, pan, issue.symbol);
}

/** Registrar keys whose allotment lookup is routed through BSE instead of the registrar's own
 *  (captcha-gated) endpoint. Bigshare issues all list on BSE, so they are answered by PAN with
 *  no captcha; resolution still uses the Bigshare adapter to identify that it is a Bigshare
 *  issue in the first place. */
export const BSE_ROUTED_REGISTRARS = new Set<string>(['bigshare']);
