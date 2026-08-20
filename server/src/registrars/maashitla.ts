import { getJson, request } from '../util/http.js';
import { logger } from '../util/logger.js';
import { toInt } from '../util/parse.js';
import type { AllotmentLookup, AllotmentQuery, RegistrarAdapter, RegistrarCompany } from './types.js';
import { RegistrarError } from './types.js';

const log = logger('maashitla');

/**
 * Maashitla's allotment page is a Vite SPA backed by a small FastAPI service, so lookups are
 * plain GETs with no session, token or captcha.
 *
 * The apex domain matters: the TLS certificate covers `maashitla.com` only, and requesting
 * `www.maashitla.com` fails verification with ERR_CERT_COMMON_NAME_INVALID.
 */
const API = 'https://api.maashitla.com/api/public-issue';
const SITE = 'https://maashitla.com/allotment-status/public-issues';

interface Company {
  company_id?: string;
  company_name?: string;
}

/**
 * The search endpoint keys on the company *name*, not the id — the SPA's dropdown uses the
 * name as its option value. So the name is what gets stored as this registrar's company code.
 */
async function listCompanies(): Promise<RegistrarCompany[]> {
  const rows = await getJson<Company[]>(`${API}/companies`, {
    headers: { Referer: SITE, Origin: 'https://maashitla.com' },
    timeoutMs: 20_000,
  });
  if (!Array.isArray(rows)) throw new RegistrarError('Maashitla returned an unexpected company list');

  const items = rows.flatMap((row) => {
    const name = (row.company_name ?? '').trim();
    return name ? [{ code: name, name }] : [];
  });
  log.info(`${items.length} issues open for lookup`);
  return items;
}

/** Field names are not documented, so every value is matched defensively. */
function pick(row: Record<string, unknown>, patterns: RegExp[]): unknown {
  for (const pattern of patterns) {
    const key = Object.keys(row).find((k) => pattern.test(k));
    if (key !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return undefined;
}

export function parseMaashitlaRecord(record: Record<string, unknown>): AllotmentLookup {
  const allotted = toInt(pick(record, [/allot(ted)?[_ ]?(shares|qty|share)/i, /^allotted$/i, /^allot/i]));
  const applied = toInt(pick(record, [/appl(ied|ication)[_ ]?(shares|qty|share)/i, /^applied$/i, /^applied/i]));
  const name = pick(record, [/^name$/i, /investor[_ ]?name/i, /holder[_ ]?name/i, /applicant/i]);
  const applicationNo = pick(record, [/appl(ication)?[_ ]?no/i, /^appno$/i]);

  if (allotted === null && applied === null) {
    // Log field names only — the values carry the investor's PAN and name.
    log.warn(`unrecognised Maashitla payload; fields: ${Object.keys(record).join(', ')}`);
    return { status: 'error', message: 'Could not read Maashitla response' };
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
  const useDemat = by === 'demat';
  if (useDemat && !demat) throw new RegistrarError('No demat account on file for this applicant');

  // The API insists on exactly one of pan, application_no or dpid_client_id.
  const query: Record<string, string> = useDemat
    ? { company_name: companyCode, dpid_client_id: demat!.id }
    : { company_name: companyCode, pan };
  const url = `${API}/search?${new URLSearchParams(query)}`;
  const res = await request(url, {
    headers: { Accept: 'application/json', Referer: SITE, Origin: 'https://maashitla.com' },
    timeoutMs: 25_000,
  });
  const text = await res.text();

  // A PAN with no application is answered with 404 {"detail":"No records found."}.
  if (res.status === 404) {
    return { status: 'not_applied', message: 'No application found' };
  }
  if (!res.ok) {
    throw new RegistrarError(`Maashitla lookup failed: HTTP ${res.status}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RegistrarError('Maashitla returned a non-JSON response');
  }

  const record = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | undefined;
  if (!record) return { status: 'not_applied', message: 'No application found' };

  return parseMaashitlaRecord(record);
}

export const maashitla: RegistrarAdapter = {
  key: 'maashitla',
  name: 'Maashitla Securities',
  driver: 'http',
  match: ['maashitla'],
  searchBy: ['pan', 'demat'],
  listCompanies,
  check,
};
