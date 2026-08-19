import { getJson } from '../util/http.js';
import { logger } from '../util/logger.js';
import { toInt } from '../util/parse.js';
import { withPage } from './browser.js';
import type { AllotmentLookup, AllotmentQuery, RegistrarAdapter, RegistrarCompany } from './types.js';
import { RegistrarError } from './types.js';

const log = logger('kfintech');

const SITE = 'https://ipostatus.kfintech.com/';
/**
 * KFin's allotment front-end is a React app talking to an unauthenticated API Gateway lambda.
 * The lookup takes no captcha, no cookie and no token — the PAN and the issue's client id are
 * passed as request *headers*, which is why this looks nothing like the old WebForms flow.
 */
const API = 'https://0uz601ms56.execute-api.ap-south-1.amazonaws.com/prod/api/query?type=pan';

interface KfinResponse {
  error?: string;
  // Field names vary by issue; everything is read defensively below.
  [key: string]: unknown;
}

let cache: { at: number; items: RegistrarCompany[] } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * The issue list is the one part that still needs a browser: it is rendered by the React app
 * into a MUI listbox rather than served by the public API. It changes a few times a day, so it
 * is fetched at most twice an hour and every actual PAN lookup goes over plain HTTP.
 */
async function listCompanies(): Promise<RegistrarCompany[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.items;

  const items = await withPage(async (page) => {
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForSelector('[role="combobox"]', { timeout: 25_000 });
    await page.locator('[role="combobox"]').first().click();
    await page.waitForSelector('[role="option"]', { timeout: 15_000 });

    return page.$$eval('[role="option"]', (els) =>
      els
        .map((el) => ({
          code: el.getAttribute('data-value') ?? '',
          name: (el.textContent ?? '').trim(),
        }))
        .filter((o) => o.code && o.name),
    );
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

async function check({ companyCode, pan }: AllotmentQuery): Promise<AllotmentLookup> {
  let json: KfinResponse;

  try {
    json = await getJson<KfinResponse>(API, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: SITE,
        Origin: 'https://ipostatus.kfintech.com',
        // The two values that actually identify the query.
        reqparam: pan,
        client_id: companyCode,
      },
      timeoutMs: 25_000,
    });
  } catch (err) {
    // A 404 with {"error":"Record Not Found"} is the normal "no application" answer.
    const body = (err as { body?: string }).body ?? '';
    if (/record not found/i.test(body)) {
      return { status: 'not_applied', message: 'No application found for this PAN', raw: body };
    }
    throw new RegistrarError(`KFin lookup failed: ${(err as Error).message}`);
  }

  if (json.error) {
    if (/not found/i.test(json.error)) {
      return { status: 'not_applied', message: 'No application found for this PAN', raw: json };
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
  // Lookups are pure HTTP; only the cached issue list touches a browser.
  driver: 'http',
  match: ['kfintech', 'kfin', 'karvy', 'kosmic'],
  listCompanies,
  check,
};
