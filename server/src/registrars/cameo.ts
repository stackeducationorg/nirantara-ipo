import * as cheerio from 'cheerio';
import { request } from '../util/http.js';
import { toInt } from '../util/parse.js';
import type {
  AllotmentLookup,
  AllotmentQuery,
  CaptchaChallenge,
  RegistrarAdapter,
  RegistrarCompany,
} from './types.js';
import { CaptchaRequiredError, RegistrarError } from './types.js';

/**
 * Cameo Corporate Services.
 *
 * A classic ASP.NET WebForms page: every postback must echo back the __VIEWSTATE and
 * __EVENTVALIDATION it was served, tied to the session cookie the page set. The captcha is a
 * server-verified image, so the token here is that session — the challenge image and the
 * later answer both have to ride the same ASP.NET_SessionId or the postback is rejected.
 *
 * The landing page at ipo.cameoindia.com is only a router; the real form lives on the
 * numbered hosts, so this fixes on the first of them.
 */
const HOST = 'https://ipostatus1.cameoindia.com';
const PAGE = `${HOST}/`;

/** Cameo's search-type dropdown keys allotment lookups by these exact strings. */
const USER_TYPE = {
  pan: 'PAN NO',
  application: 'APPLICATION NO',
  demat: 'DP ID-CLIENT ID',
} as const;

interface FormState {
  cookie: string;
  viewState: string;
  viewStateGen: string;
  eventValidation: string;
  captchaToken: string;
}

/** Pulls the hidden WebForms fields and the captcha token out of a freshly-served page. */
function readForm(html: string, cookie: string): FormState {
  const $ = cheerio.load(html);
  const val = (id: string) => $(`#${id}`).attr('value') ?? '';
  const captchaSrc = $('#imgCaptcha').attr('src') ?? '';
  const token = /GenerateCaptcha\.aspx\?(\d+)/.exec(captchaSrc)?.[1] ?? '';
  return {
    cookie,
    viewState: val('__VIEWSTATE'),
    viewStateGen: val('__VIEWSTATEGENERATOR'),
    eventValidation: val('__EVENTVALIDATION'),
    captchaToken: token,
  };
}

async function loadForm(): Promise<{ state: FormState; html: string }> {
  const res = await request(PAGE, { timeoutMs: 25_000 });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const html = await res.text();
  return { state: readForm(html, cookie), html };
}

async function listCompanies(): Promise<RegistrarCompany[]> {
  const { html } = await loadForm();
  const $ = cheerio.load(html);
  return $('#drpCompany option')
    .toArray()
    .flatMap((el) => {
      const code = ($(el).attr('value') ?? '').trim();
      const name = $(el).text().trim();
      if (!code || code === '0' || !name || name.startsWith('---')) return [];
      return [{ code, name }];
    });
}

/**
 * Fetches a fresh captcha image on a live session, and returns it as a data: URI along with
 * the session token needed to answer it. The whole form state is stashed on the token so the
 * eventual submit does not have to reload the page and get a *different* captcha.
 */
const pending = new Map<string, FormState>();

async function newCaptcha(): Promise<CaptchaChallenge> {
  const { state } = await loadForm();
  if (!state.captchaToken) throw new RegistrarError('Cameo did not present a captcha');

  const img = await request(`${HOST}/GenerateCaptcha.aspx?${state.captchaToken}`, {
    headers: { Cookie: state.cookie, Referer: PAGE },
    timeoutMs: 20_000,
  });
  const buf = Buffer.from(await img.arrayBuffer());
  const mime = img.headers.get('content-type')?.split(';')[0] || 'image/jpeg';

  // The session id is what actually ties an answer back to this image; expose it as the token.
  pending.set(state.cookie, state);
  // Bound the map so a burst of unfinished challenges cannot grow it without limit.
  if (pending.size > 500) pending.delete(pending.keys().next().value as string);

  return { token: state.cookie, image: `data:${mime};base64,${buf.toString('base64')}` };
}

async function check({ companyCode, pan, demat, by, captcha }: AllotmentQuery): Promise<AllotmentLookup> {
  if (!captcha) throw new CaptchaRequiredError(await newCaptcha());

  const state = pending.get(captcha.token);
  if (!state) {
    // The session behind this token has expired or was never issued here; start over.
    throw new CaptchaRequiredError(await newCaptcha(), 'Captcha expired — here is a new one');
  }

  const useDemat = by === 'demat';
  if (useDemat && !demat) throw new RegistrarError('No demat account on file for this applicant');

  const userType = useDemat ? USER_TYPE.demat : USER_TYPE.pan;
  const folio = useDemat ? demat!.id : pan;

  const form = new URLSearchParams({
    __EVENTTARGET: '',
    __EVENTARGUMENT: '',
    __VIEWSTATE: state.viewState,
    __VIEWSTATEGENERATOR: state.viewStateGen,
    __EVENTVALIDATION: state.eventValidation,
    drpCompany: companyCode,
    ddlUserTypes: userType,
    txtfolio: folio,
    txt_phy_captcha: captcha.answer,
    btngenerate: 'Submit',
  });

  const res = await request(PAGE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: state.cookie,
      Referer: PAGE,
      Origin: HOST,
    },
    body: form.toString(),
    timeoutMs: 25_000,
  });
  const html = await res.text();
  pending.delete(captcha.token); // a token is spent on one submit whatever the outcome

  const $ = cheerio.load(html);
  const pageText = $('body').text().replace(/\s+/g, ' ');

  if (/invalid captcha|wrong captcha|captcha (does not|doesn.t) match|enter (the )?captcha/i.test(pageText)) {
    throw new CaptchaRequiredError(await newCaptcha(), 'Incorrect captcha');
  }

  return parseCameoResult($, pageText);
}

/**
 * Cameo renders the outcome into a result table rather than JSON. Field labels vary between
 * issues, so the allotted and applied quantities are matched by their row labels defensively.
 */
export function parseCameoResult($: cheerio.CheerioAPI, pageText: string): AllotmentLookup {
  if (/no record|not found|no data|invalid pan|record not available/i.test(pageText)) {
    return { status: 'not_applied', message: 'No application found' };
  }

  const cell = (labels: RegExp[]): string | null => {
    let found: string | null = null;
    $('table tr').each((_, tr) => {
      const cells = $(tr).find('td');
      if (cells.length < 2) return;
      const label = $(cells[0]).text().trim();
      if (labels.some((re) => re.test(label))) {
        found = $(cells[cells.length - 1]).text().trim();
        return false;
      }
    });
    return found;
  };

  const allotted = toInt(cell([/allot(ted)?\s*(shares|qty)/i, /shares?\s*allot/i, /^allot/i]));
  const applied = toInt(cell([/appl(ied|ication)\s*(shares|qty)/i, /shares?\s*appl/i, /^applied/i]));
  const name = cell([/^name$/i, /investor\s*name/i, /holder\s*name/i, /applicant/i]);
  const applicationNo = cell([/appl(ication)?\s*no/i, /^appln?\s*no/i]);

  if (allotted === null && applied === null) {
    // A shape we do not recognise — but the page clearly was not a "no record" answer, so
    // report it as unread rather than silently claiming nothing was applied for.
    return { status: 'error', message: 'Could not read Cameo response' };
  }

  return {
    status: allotted && allotted > 0 ? 'allotted' : 'not_allotted',
    allottedQty: allotted ?? 0,
    appliedQty: applied,
    nameOnRecord: name || null,
    applicationNo: applicationNo || null,
  };
}

export const cameo: RegistrarAdapter = {
  key: 'cameo',
  name: 'Cameo Corporate Services',
  driver: 'http',
  match: ['cameo'],
  searchBy: ['pan', 'demat'],
  needsCaptcha: true,
  listCompanies,
  check,
  newCaptcha,
};
