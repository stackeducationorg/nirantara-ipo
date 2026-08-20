import * as cheerio from 'cheerio';
import { request } from '../util/http.js';
import { logger } from '../util/logger.js';
import { toInt } from '../util/parse.js';
import type { AllotmentLookup, AllotmentQuery, RegistrarAdapter, RegistrarCompany } from './types.js';
import { RegistrarError } from './types.js';

const log = logger('skyline');

/**
 * Skyline serves a plain PHP form with no captcha, so the whole flow is reproducible over
 * HTTP. It does take three requests, because the PAN field only appears after an issue has
 * been selected and the second page carries a per-session CSRF token:
 *
 *   1. GET  /ipo.php                  -> issue dropdown + PHPSESSID
 *   2. POST /display_application.php  -> company selected, yields csrf_token
 *   3. POST /display_application.php  -> the actual PAN lookup
 */
const SITE = 'https://www.skylinerta.com/ipo.php';
const FORM = 'https://www.skylinerta.com/display_application.php';

function cookiesFrom(res: Response): string {
  return (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function listCompanies(): Promise<RegistrarCompany[]> {
  const res = await request(SITE, { timeoutMs: 25_000 });
  if (!res.ok) throw new RegistrarError(`Skyline issue list failed: HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());

  const items = $('#company option')
    .toArray()
    .flatMap((el) => {
      const code = ($(el).attr('value') ?? '').trim();
      const name = $(el).text().trim();
      if (!code || !name) return [];
      return [{ code, name }];
    });
  log.info(`${items.length} issues open for lookup`);
  return items;
}

function post(body: Record<string, string>, cookie: string, referer: string) {
  return request(FORM, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: referer,
      Origin: 'https://www.skylinerta.com',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams(body).toString(),
    timeoutMs: 25_000,
  });
}

/**
 * The result page has no stable ids, so the table is read by matching each row's label
 * against the quantity we want. Exported to allow testing against captured markup.
 */
export function parseSkylineResult(html: string): AllotmentLookup {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ');

  if (/no record found|no records found|not found/i.test(text)) {
    return { status: 'not_applied', message: 'No application found for this PAN' };
  }

  const cells: string[] = [];
  $('table td, table th').each((_, el) => {
    cells.push($(el).text().trim());
  });

  /** Reads the cell following the first label that matches, which is how these tables read. */
  const after = (pattern: RegExp): string | undefined => {
    const i = cells.findIndex((c) => pattern.test(c));
    return i >= 0 && i + 1 < cells.length ? cells[i + 1] : undefined;
  };

  const allotted = toInt(after(/allot(ted)?\s*(shares|qty|quantity)?/i));
  const applied = toInt(after(/appl(ied|ication)\s*(shares|qty|quantity)?/i));
  const name = after(/^\s*name\b/i) ?? after(/investor|applicant|holder/i);
  const applicationNo = after(/application\s*(no|number)/i);

  if (allotted === null && applied === null) {
    // Log structure only — these cells hold the investor's PAN and name.
    log.warn(`unrecognised Skyline result; ${cells.length} cells, tables=${$('table').length}`);
    return { status: 'error', message: 'Could not read Skyline response' };
  }

  return {
    status: allotted && allotted > 0 ? 'allotted' : 'not_allotted',
    allottedQty: allotted ?? 0,
    appliedQty: applied,
    nameOnRecord: name ?? null,
    applicationNo: applicationNo ?? null,
  };
}

async function check({ companyCode, pan }: AllotmentQuery): Promise<AllotmentLookup> {
  const landing = await request(SITE, { timeoutMs: 25_000 });
  const cookie = cookiesFrom(landing);
  await landing.text();

  const selected = await post({ company: companyCode }, cookie, SITE);
  if (!selected.ok) throw new RegistrarError(`Skyline company select failed: HTTP ${selected.status}`);
  const selectedHtml = await selected.text();

  const $ = cheerio.load(selectedHtml);
  const csrf = $('input[name="csrf_token"]').attr('value') ?? '';
  const action = $('input[name="action"]').attr('value') ?? 'search';
  if (!csrf) throw new RegistrarError('Skyline did not issue a CSRF token');

  const result = await post(
    { company: companyCode, client_id: '', application_no: '', pan, csrf_token: csrf, action },
    cookie,
    FORM,
  );
  if (!result.ok) throw new RegistrarError(`Skyline lookup failed: HTTP ${result.status}`);

  return parseSkylineResult(await result.text());
}

export const skyline: RegistrarAdapter = {
  key: 'skyline',
  name: 'Skyline Financial Services',
  driver: 'http',
  match: ['skyline'],
  listCompanies,
  check,
};
