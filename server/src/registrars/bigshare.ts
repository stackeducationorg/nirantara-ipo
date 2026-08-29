import * as cheerio from 'cheerio';
import { getText, postJson } from '../util/http.js';
import { toInt } from '../util/parse.js';
import type { AllotmentLookup, AllotmentQuery, RegistrarAdapter, RegistrarCompany } from './types.js';
import { RegistrarError } from './types.js';

const STATUS_PAGE = 'https://ipo.bigshareonline.com/IPO_Status.html';
const API = 'https://ipo.bigshareonline.com/Data.aspx/FetchIpodetails';

interface BigshareResponse {
  d?: {
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

async function check({ companyCode, pan, demat, by }: AllotmentQuery): Promise<AllotmentLookup> {
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
  };

  let json: BigshareResponse;
  try {
    json = await postJson<BigshareResponse>(API, payload, {
      headers: { Referer: STATUS_PAGE, Origin: 'https://ipo.bigshareonline.com' },
      timeoutMs: 25_000,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    // A 500 here is the captcha rejection; Bigshare does not distinguish it in the body.
    if (status === 500 || status === 400) {
      throw new RegistrarError(
        'Bigshare now requires a captcha for allotment lookups — check directly at ipo.bigshareonline.com',
        false,
      );
    }
    throw err;
  }

  const d = json.d;
  if (!d) throw new RegistrarError('Bigshare returned an empty response');

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
  listCompanies,
  check,
};
