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

async function check({ companyCode, pan }: AllotmentQuery): Promise<AllotmentLookup> {
  // The on-page captcha is generated in JS and stored in sessionStorage — it is never sent to
  // or verified by the server, so the page method accepts a direct PAN lookup.
  const payload = {
    Applicationno: '',
    Company: companyCode,
    SelectionType: 'PN',
    PanNo: pan,
    txtcsdl: '',
    txtDPID: '',
    txtClId: '',
    ddlType: '0',
    lang: 'en',
  };

  const json = await postJson<BigshareResponse>(API, payload, {
    headers: { Referer: STATUS_PAGE, Origin: 'https://ipo.bigshareonline.com' },
    timeoutMs: 25_000,
  });

  const d = json.d;
  if (!d) throw new RegistrarError('Bigshare returned an empty response');

  const dpid = (d.DPID ?? '').trim();
  if (!dpid || /no data found/i.test(dpid)) {
    return { status: 'not_applied', message: 'No application found for this PAN', raw: d };
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
  listCompanies,
  check,
};
