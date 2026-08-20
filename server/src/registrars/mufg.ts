import crypto from 'node:crypto';
import { postJson } from '../util/http.js';
import { logger } from '../util/logger.js';
import { toInt } from '../util/parse.js';
import type { AllotmentLookup, AllotmentQuery, RegistrarAdapter, RegistrarCompany } from './types.js';
import { RegistrarError } from './types.js';

const log = logger('mufg');

/**
 * MUFG Intime (formerly Link Intime) handles a large share of Indian IPOs.
 *
 * The public page is an ASP.NET WebForms app whose lookups run through page methods that
 * speak JSON, so no browser is involved. Note the page is `public-issues.html` — hitting
 * `IPO.aspx` directly renders an empty document with no form at all.
 *
 * The captcha field exists in the markup but its validation is commented out in the site's
 * own JavaScript, and the server does not enforce it.
 */
const ORIGIN = 'https://in.mpms.mufg.com';
const BASE = `${ORIGIN}/Initial_Offer`;
const PAGE = `${BASE}/public-issues.html`;

/** CHKVAL selects the search mode. 2 is application number and 4 is IFSC, neither used here. */
const MODE_PAN = '1';
const MODE_DEMAT = '3';

interface PageMethodResponse {
  d?: string;
}

/**
 * Mirrors the site's `encVal()`: AES-128-CBC with the key and IV both set to the literal
 * string '8080808080808080'. It is obfuscation rather than a secret — the key is in the
 * page source — but the endpoint rejects requests whose token is absent or malformed.
 */
function encryptToken(value: string): string {
  const key = Buffer.from('8080808080808080', 'utf8');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, key);
  return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64');
}

async function pageMethod(method: string, body: Record<string, string>): Promise<string> {
  const json = await postJson<PageMethodResponse>(`${BASE}/IPO.aspx/${method}`, body, {
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: PAGE,
      Origin: ORIGIN,
    },
    timeoutMs: 25_000,
  });
  if (typeof json.d !== 'string') throw new RegistrarError(`MUFG ${method} returned no payload`);
  return json.d;
}

/** Every lookup needs a fresh token; they are cheap and short-lived, so none is cached. */
async function freshToken(): Promise<string> {
  return encryptToken(await pageMethod('generateToken', {}));
}

/**
 * Page methods return an ADO.NET `<NewDataSet>` document as a string. `<NewDataSet />` is the
 * empty result, which is how "no application for this PAN" arrives.
 */
function parseRows(xml: string): Record<string, string>[] {
  return [...xml.matchAll(/<Table>([\s\S]*?)<\/Table>/g)].map((match) => {
    const row: Record<string, string> = {};
    for (const field of match[1].matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) {
      row[field[1]] = field[2].trim();
    }
    return row;
  });
}

async function listCompanies(): Promise<RegistrarCompany[]> {
  const xml = await pageMethod('GetDetails', { MODE: '1' });
  const items = parseRows(xml).flatMap((row) => {
    const code = row.company_id;
    const name = row.companyname;
    if (!code || !name) return [];
    // Every issue is suffixed " - IPO" in the dropdown; it only hurts name matching.
    return [{ code, name: name.replace(/\s*-\s*IPO\s*$/i, '').trim() }];
  });
  log.info(`${items.length} issues open for lookup`);
  return items;
}

/** Field names vary a little between issues, so each value is looked up defensively. */
function pick(row: Record<string, string>, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const key = Object.keys(row).find((k) => pattern.test(k));
    if (key && row[key] !== '') return row[key];
  }
  return undefined;
}

export function parseMufgRows(rows: Record<string, string>[]): AllotmentLookup {
  if (rows.length === 0) {
    return { status: 'not_applied', message: 'No application found' };
  }

  const row = rows[0];
  const allotted = toInt(pick(row, [/^allot(ted)?[_ ]?(shares|qty)/i, /shares[_ ]?allot/i, /^allot/i]));
  const applied = toInt(pick(row, [/^appl(ied|y)[_ ]?(shares|qty)/i, /shares[_ ]?appl/i, /^applied/i]));
  const name = pick(row, [/^name$/i, /investor[_ ]?name/i, /holder[_ ]?name/i]);
  const applicationNo = pick(row, [/appl(n|ication)[_ ]?no/i, /^appno$/i]);

  if (allotted === null && applied === null) {
    // An unfamiliar shape. Log field names only — the values are the investor's PAN and name.
    log.warn(`unrecognised MUFG payload; fields: ${Object.keys(row).join(', ')}`);
    return { status: 'error', message: 'Could not read MUFG response' };
  }

  return {
    status: allotted && allotted > 0 ? 'allotted' : 'not_allotted',
    allottedQty: allotted ?? 0,
    appliedQty: applied,
    nameOnRecord: name ?? null,
    applicationNo: applicationNo ?? null,
  };
}

async function check({ companyCode, pan, demat, by }: AllotmentQuery): Promise<AllotmentLookup> {
  const useDemat = by === 'demat';
  if (useDemat && !demat) throw new RegistrarError('No demat account on file for this applicant');

  // The parameter is named PAN whichever mode is in use; CHKVAL is what actually selects it.
  const xml = await pageMethod('SearchOnPan', {
    clientid: companyCode,
    PAN: useDemat ? demat!.id : pan,
    IFSC: '',
    CHKVAL: useDemat ? MODE_DEMAT : MODE_PAN,
    token: await freshToken(),
  });
  return parseMufgRows(parseRows(xml));
}

export const mufg: RegistrarAdapter = {
  key: 'mufg',
  name: 'MUFG Intime (Link Intime)',
  driver: 'http',
  match: ['mufg', 'linkintime', 'link intime', 'mpms'],
  searchBy: ['pan', 'demat'],
  listCompanies,
  check,
};
