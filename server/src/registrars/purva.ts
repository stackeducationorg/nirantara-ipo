import * as cheerio from 'cheerio';
import { request } from '../util/http.js';
import { logger } from '../util/logger.js';
import { toInt } from '../util/parse.js';
import type { AllotmentLookup, AllotmentQuery, RegistrarAdapter, RegistrarCompany } from './types.js';
import { RegistrarError } from './types.js';

const log = logger('purva');

/**
 * Purva runs a small Django app with no captcha. The search is a POST-redirect-GET: the form
 * POST answers 302 and the result is rendered on the page it redirects to.
 *
 * That redirect is why the session cookie has to be carried by hand — following it without
 * the cookie simply re-renders the empty form, which looks deceptively like "no application".
 */
const ORIGIN = 'https://www.purvashare.com';
const PAGE = `${ORIGIN}/investor-service/ipo-query`;

function mergeCookies(existing: string, res: Response): string {
  const jar = new Map<string, string>();
  for (const pair of existing.split('; ').filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function loadForm(): Promise<{ cookie: string; csrf: string; html: string }> {
  const res = await request(PAGE, { timeoutMs: 25_000 });
  if (!res.ok) throw new RegistrarError(`Purva form failed: HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const csrf = $('input[name="csrfmiddlewaretoken"]').attr('value') ?? '';
  if (!csrf) throw new RegistrarError('Purva did not issue a CSRF token');
  return { cookie: mergeCookies('', res), csrf, html };
}

async function listCompanies(): Promise<RegistrarCompany[]> {
  const { html } = await loadForm();
  const $ = cheerio.load(html);

  const items = $('select[name="company_id"] option')
    .toArray()
    .flatMap((el) => {
      const code = ($(el).attr('value') ?? '').trim();
      const name = $(el).text().trim();
      if (!code || !name || /choose a company/i.test(name)) return [];
      return [{ code, name }];
    });
  log.info(`${items.length} issues open for lookup`);
  return items;
}

/**
 * Exported for testing. Purva's "found" markup could not be verified against a live
 * application, so anything that is neither a recognisable result table nor an explicit
 * not-found message is reported as an error rather than guessed at as "not allotted".
 */
export function parsePurvaResult(html: string): AllotmentLookup {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ');

  if (/no record|not found|no data|no application|invalid pan/i.test(text)) {
    return { status: 'not_applied', message: 'No application found for this PAN' };
  }

  const cells: string[] = [];
  $('table td, table th').each((_, el) => {
    cells.push($(el).text().trim());
  });

  const after = (pattern: RegExp): string | undefined => {
    const i = cells.findIndex((c) => pattern.test(c));
    return i >= 0 && i + 1 < cells.length ? cells[i + 1] : undefined;
  };

  const allotted = toInt(after(/allot(ted)?\s*(shares|qty|quantity)?/i));
  const applied = toInt(after(/appl(ied|ication)\s*(shares|qty|quantity)?/i));

  if (allotted === null && applied === null) {
    // No result table and no not-found message: the form was probably re-rendered empty,
    // which usually means the session cookie was lost rather than that nothing was found.
    log.warn(`unrecognised Purva result; ${cells.length} table cells`);
    return { status: 'error', message: 'Could not read Purva response' };
  }

  return {
    status: allotted && allotted > 0 ? 'allotted' : 'not_allotted',
    allottedQty: allotted ?? 0,
    appliedQty: applied,
    nameOnRecord: after(/^\s*name\b/i) ?? after(/investor|applicant|holder/i) ?? null,
    applicationNo: after(/application\s*(no|number)/i) ?? null,
  };
}

async function check({ companyCode, pan }: AllotmentQuery): Promise<AllotmentLookup> {
  const { cookie, csrf } = await loadForm();

  const posted = await request(PAGE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: PAGE,
      Origin: ORIGIN,
      Cookie: cookie,
    },
    body: new URLSearchParams({
      csrfmiddlewaretoken: csrf,
      company_id: companyCode,
      applicationNumber: '',
      panNumber: pan,
    }).toString(),
    redirect: 'manual',
    timeoutMs: 30_000,
  });

  // Django answers 302 and stashes the result for the redirected GET, so the updated
  // session cookie has to travel with it.
  if (posted.status >= 300 && posted.status < 400) {
    const location = posted.headers.get('location') ?? PAGE;
    const target = new URL(location, ORIGIN).toString();
    const followed = await request(target, {
      headers: { Referer: PAGE, Cookie: mergeCookies(cookie, posted) },
      timeoutMs: 25_000,
    });
    if (!followed.ok) throw new RegistrarError(`Purva result page failed: HTTP ${followed.status}`);
    return parsePurvaResult(await followed.text());
  }

  if (!posted.ok) throw new RegistrarError(`Purva lookup failed: HTTP ${posted.status}`);
  return parsePurvaResult(await posted.text());
}

export const purva: RegistrarAdapter = {
  key: 'purva',
  name: 'Purva Sharegistry',
  driver: 'http',
  match: ['purva'],
  listCompanies,
  check,
};
