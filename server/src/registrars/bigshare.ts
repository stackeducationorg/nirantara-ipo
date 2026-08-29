import * as cheerio from 'cheerio';
import { getJson, getText, postJson } from '../util/http.js';
import { toInt } from '../util/parse.js';
import type {
  AllotmentLookup,
  AllotmentQuery,
  CaptchaChallenge,
  RegistrarAdapter,
  RegistrarCompany,
} from './types.js';
import { CaptchaRequiredError, RegistrarError } from './types.js';

const STATUS_PAGE = 'https://ipo.bigshareonline.com/IPO_Status.html';
const API = 'https://ipo.bigshareonline.com/Data.aspx/FetchIpodetails';
const CAPTCHA_API = 'https://ipo.bigshareonline.com/Captcha.ashx';

interface CaptchaResponse {
  token?: string;
  image?: string;
  Token?: string;
  Image?: string;
}

/**
 * Bigshare issues a signed token alongside a PNG of the challenge. The token is opaque to us
 * — it only has to travel back with whatever the user typed.
 */
async function newCaptcha(): Promise<CaptchaChallenge> {
  const json = await getJson<CaptchaResponse>(CAPTCHA_API, {
    headers: { Referer: STATUS_PAGE, Origin: 'https://ipo.bigshareonline.com', Accept: 'application/json' },
    timeoutMs: 20_000,
  });
  // The site's own script accepts either casing, so a cached page or a proxy that rewrites
  // JSON does not silently break the flow.
  const token = json.token ?? json.Token;
  const image = json.image ?? json.Image;
  if (!token || !image) throw new RegistrarError('Bigshare did not return a captcha');
  return { token, image };
}

interface BigshareResponse {
  d?: {
    Status?: string;
    Message?: string;
    APPLICATION_NO?: string;
    DPID?: string;
    Name?: string;
    APPLIED?: string;
    ALLOTED?: string;
  };
}

/**
 * Bigshare renders the company dropdown straight into the status page and comments out
 * issues whose lookup window has closed. cheerio parses those commented blocks as comment
 * nodes, so selecting `option` elements naturally yields only the live issues.
 */
async function listCompanies(): Promise<RegistrarCompany[]> {
  const html = await getText(STATUS_PAGE, { headers: { Referer: STATUS_PAGE } });
  const $ = cheerio.load(html);

  return $('#ddlCompany option')
    .toArray()
    .flatMap((el) => {
      const code = ($(el).attr('value') ?? '').trim();
      const name = $(el).text().trim();
      if (!code || !name || name.startsWith('--')) return [];
      return [{ code, name }];
    });
}

async function check({ companyCode, pan, demat, by, captcha }: AllotmentQuery): Promise<AllotmentLookup> {
  const useDemat = by === 'demat';
  if (useDemat && !demat) throw new RegistrarError('No demat account on file for this applicant');

  // Bigshare keeps CDSL in one field but splits NSDL into the 8-character DP ID and the
  // 8-digit client id, so the stored "IN..." value is cut in half here.
  const nsdl = useDemat && demat!.depository === 'NSDL';

  // Bigshare added a server-verified captcha: Captcha.ashx issues a signed token with a
  // base64 PNG, and FetchIpodetails now rejects any request without a matching answer.
  // Previously the captcha was drawn client-side and never checked, which is why a direct
  // call used to work. An image challenge cannot be answered from a server, so this is
  // reported plainly instead of surfacing as an opaque HTTP 500.
  const payload = {
    Applicationno: '',
    Company: companyCode,
    SelectionType: useDemat ? 'BN' : 'PN',
    PanNo: useDemat ? '' : pan,
    txtcsdl: useDemat && demat!.depository === 'CDSL' ? demat!.id : '',
    txtDPID: nsdl ? demat!.id.slice(0, 8) : '',
    txtClId: nsdl ? demat!.id.slice(8) : '',
    ddlType: useDemat ? demat!.depository : '0',
    lang: 'en',
    CaptchaToken: captcha?.token ?? '',
    CaptchaAnswer: captcha?.answer ?? '',
    // Re-reads a record the user already solved a captcha for. Unused here: every lookup
    // this adapter makes is a fresh search.
    ResultToken: '',
  };

  // Without a captcha there is nothing to send, so ask for a challenge straight away rather
  // than making a call that is certain to be refused.
  if (!captcha) throw new CaptchaRequiredError(await newCaptcha());

  const json = await postJson<BigshareResponse>(API, payload, {
    headers: { Referer: STATUS_PAGE, Origin: 'https://ipo.bigshareonline.com' },
    timeoutMs: 25_000,
  });

  const d = json.d;
  if (!d) throw new RegistrarError('Bigshare returned an empty response');

  // A wrong or expired answer comes back as a 200 with Status: CAPTCHA. Issue a fresh
  // challenge with it — the old token is spent, so retrying with it would fail again.
  if (d.Status === 'CAPTCHA') {
    throw new CaptchaRequiredError(await newCaptcha(), d.Message ?? 'Invalid captcha code');
  }

  const dpid = (d.DPID ?? '').trim();
  if (!dpid || /no data found/i.test(dpid)) {
    return { status: 'not_applied', message: 'No application found', raw: d };
  }

  const applied = toInt(d.APPLIED);
  const allotted = toInt(d.ALLOTED);

  return {
    status: allotted && allotted > 0 ? 'allotted' : 'not_allotted',
    appliedQty: applied,
    allottedQty: allotted ?? 0,
    nameOnRecord: (d.Name ?? '').trim() || null,
    applicationNo: (d.APPLICATION_NO ?? '').trim() || null,
    raw: d,
  };
}

export const bigshare: RegistrarAdapter = {
  key: 'bigshare',
  name: 'Bigshare Services',
  driver: 'http',
  match: ['bigshare'],
  searchBy: ['pan', 'demat'],
  needsCaptcha: true,
  newCaptcha,
  listCompanies,
  check,
};
