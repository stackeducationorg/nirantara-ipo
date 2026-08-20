import { getJson, getText } from '../util/http.js';
import { logger } from '../util/logger.js';
import { toInt } from '../util/parse.js';
import type { AllotmentLookup, AllotmentQuery, RegistrarAdapter, RegistrarCompany } from './types.js';
import { RegistrarError } from './types.js';

const log = logger('kfintech');

const SITE = 'https://ipostatus.kfintech.com/';
/**
 * KFin's allotment front-end is a React app talking to an unauthenticated API Gateway lambda.
 * The lookup takes no captcha, no cookie and no token — the identifier and the issue's client
 * id are passed as request *headers*, which is why this looks nothing like the old WebForms
 * flow. `type` selects the identifier: `pan` or `dpclid` for a demat account.
 */
const API_BASE = 'https://0uz601ms56.execute-api.ap-south-1.amazonaws.com/prod/api/query?type=';

interface KfinResponse {
  error?: string;
  // Field names vary by issue; everything is read defensively below.
  [key: string]: unknown;
}

let cache: { at: number; items: RegistrarCompany[] } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * The React app makes no network call for its issue list — the open issues are compiled into
 * its JavaScript bundle as a JSON literal. Reading them straight out of the bundle means this
 * adapter needs no browser at all, so it runs on a small host.
 *
 * The bundle filename is content-hashed and changes on every KFin deploy, so it is resolved
 * from the index page rather than hard-coded.
 */
async function listCompanies(): Promise<RegistrarCompany[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.items;

  const html = await getText(SITE, { timeoutMs: 25_000 });
  const src = /src="([^"]*main[^"]*\.js)"/.exec(html);
  if (!src) throw new RegistrarError('KFin index did not reference a main bundle');

  const bundle = await getText(new URL(src[1], SITE).toString(), { timeoutMs: 30_000 });
  const literal = /\[\s*\{\s*"clientId"\s*:[\s\S]*?\}\s*\]/.exec(bundle);
  if (!literal) throw new RegistrarError('KFin bundle did not contain an issue list');

  let parsed: { clientId?: string; name?: string }[];
  try {
    parsed = JSON.parse(literal[0]);
  } catch (err) {
    throw new RegistrarError(`KFin issue list is not valid JSON: ${(err as Error).message}`);
  }

  const items = parsed.flatMap((row) => {
    const code = (row.clientId ?? '').trim();
    const name = (row.name ?? '').trim();
    return code && name ? [{ code, name }] : [];
  });

  cache = { at: Date.now(), items };
  log.info(`${items.length} issues open for lookup`);
  return items;
}

/**
 * A successful KFin record looks like:
 *   { All_Shares: "0", App_Shares: "154", Appln_No: "...", DP_CLID: "...",
 *     Name: "MR. ...", Pan_No: "ABCDE1234F" }
 *
 * Note `All_Shares` is *allotted* and `App_Shares` is *applied* — the two differ by one letter,
 * so they are matched exactly rather than by a loose "allot"/"appli" pattern.
 */
function pick(obj: Record<string, unknown>, keys: string[], patterns: RegExp[] = []): unknown {
  for (const key of keys) {
    const found = Object.keys(obj).find((k) => k.toLowerCase() === key.toLowerCase());
    if (found !== undefined && obj[found] !== null && obj[found] !== '') return obj[found];
  }
  for (const pattern of patterns) {
    const found = Object.keys(obj).find((k) => pattern.test(k));
    if (found !== undefined && obj[found] !== null && obj[found] !== '') return obj[found];
  }
  return undefined;
}

/**
 * Turns one KFin record into an allotment outcome. Exported so it can be exercised against
 * real payload shapes without making a network call.
 */
export function parseKfinRecord(record: Record<string, unknown>, companyCode = ''): AllotmentLookup {
  const allotted = toInt(
    pick(record, ['All_Shares', 'Alloted_Shares', 'Allotted_Shares'], [/allot(ted|ment)?[_ ]?(qty|shares)/i]),
  );
  const applied = toInt(
    pick(record, ['App_Shares', 'Applied_Shares', 'Appl_Shares'], [/appli(ed|cation)[_ ]?(qty|shares)/i]),
  );
  const name = pick(record, ['Name', 'Investor_Name'], [/holder[_ ]?name/i]);
  const applicationNo = pick(record, ['Appln_No', 'Application_No'], [/appl(n|ication)[_ ]?no/i]);

  if (allotted === null && applied === null) {
    // A shape we have not seen. Log only the field names — the values are the investor's PAN,
    // name and demat id, which must never reach a log file.
    log.warn(`unrecognised KFin payload for ${companyCode}; fields: ${Object.keys(record).join(', ')}`);
    return { status: 'error', message: 'Could not read KFin response' };
  }

  return {
    status: allotted && allotted > 0 ? 'allotted' : 'not_allotted',
    allottedQty: allotted ?? 0,
    appliedQty: applied,
    nameOnRecord: typeof name === 'string' ? name.trim() : null,
    applicationNo: applicationNo ? String(applicationNo) : null,
  };
}

async function check({ companyCode, pan, demat, by }: AllotmentQuery): Promise<AllotmentLookup> {
  let json: KfinResponse;

  const useDemat = by === 'demat';
  if (useDemat && !demat) throw new RegistrarError('No demat account on file for this applicant');

  // KFin's front-end sends type=dpclid for a demat lookup, with CDSL ids passed as their bare
  // 16 digits and NSDL ids prefixed "IN" (the prefix is added by the page, not typed by the
  // user). Stored ids already carry it, so only a missing prefix is repaired here.
  const type = useDemat ? 'dpclid' : 'pan';
  const reqparam = useDemat
    ? demat!.depository === 'NSDL' && !demat!.id.toUpperCase().startsWith('IN')
      ? `IN${demat!.id}`
      : demat!.id
    : pan;

  try {
    json = await getJson<KfinResponse>(`${API_BASE}${type}`, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: SITE,
        Origin: 'https://ipostatus.kfintech.com',
        // The two values that actually identify the query.
        reqparam,
        client_id: companyCode,
      },
      timeoutMs: 25_000,
    });
  } catch (err) {
    // A 404 with {"error":"Record Not Found"} is the normal "no application" answer.
    const body = (err as { body?: string }).body ?? '';
    if (/record not found/i.test(body)) {
      return { status: 'not_applied', message: 'No application found', raw: body };
    }
    throw new RegistrarError(`KFin lookup failed: ${(err as Error).message}`);
  }

  if (json.error) {
    if (/not found/i.test(json.error)) {
      return { status: 'not_applied', message: 'No application found', raw: json };
    }
    throw new RegistrarError(`KFin: ${json.error}`);
  }

  // Successful payloads nest the record under varying keys; unwrap a single-object envelope.
  const record = (Array.isArray(json.data) ? json.data[0] : (json.data ?? json)) as Record<string, unknown>;
  return parseKfinRecord(record, companyCode);
}

export const kfintech: RegistrarAdapter = {
  key: 'kfintech',
  name: 'KFin Technologies',
  driver: 'http',
  match: ['kfintech', 'kfin', 'karvy', 'kosmic'],
  searchBy: ['pan', 'demat'],
  listCompanies,
  check,
};
