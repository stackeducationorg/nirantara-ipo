import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../util/logger.js';
import type { BrowserProfile } from './browserAdapter.js';

const log = logger('registrar');

/**
 * Selector profiles for the form-driven registrars.
 *
 * IMPORTANT: KFin and MUFG sit behind Imperva/Akamai bot walls, so their markup could not be
 * inspected directly while these defaults were written — the selectors below are the documented
 * starting point, not verified truth, and registrars redesign these pages often.
 *
 * Override any field without touching this file by dropping a `registrar-profiles.json` into
 * DATA_DIR, keyed by registrar. Run `npm run sync -w server -- probe <key>` to open the page in
 * a headed browser and confirm the selectors.
 */
const DEFAULTS: Record<string, BrowserProfile> = {
  kfintech: {
    key: 'kfintech',
    name: 'KFin Technologies',
    match: ['kfintech', 'kfin', 'karvy', 'kosmic'],
    url: 'https://kosmic.kfintech.com/ipostatus/',
    companySelect: '#ddl_ipo',
    searchType: { selector: '#query', match: /pan/i },
    panInput: '#pan',
    submit: '#btn_submit_query',
    result: '#result, .table-responsive, #divResult',
    captcha: 'image',
  },

  mufg: {
    key: 'mufg',
    name: 'MUFG Intime (Link Intime)',
    match: ['mufg', 'linkintime', 'link intime', 'mpms'],
    url: 'https://in.mpms.mufg.com/Initial_Offer/IPO.aspx',
    companySelect: '#ddlCompany',
    searchType: { selector: '#ddlSelectionType', match: /pan/i },
    panInput: '#txtPan',
    submit: '#btnSearch',
    result: '#grdIPO, #divResult, .table-responsive',
    captcha: 'image',
  },

  skyline: {
    key: 'skyline',
    name: 'Skyline Financial Services',
    match: ['skyline'],
    url: 'https://www.skylinerta.com/ipo.php',
    companySelect: '#company',
    panInput: 'input[name="pan"], #pan',
    submit: 'input[type="submit"], button[type="submit"]',
    result: '.checkfield, table',
    captcha: 'none',
  },

  maashitla: {
    key: 'maashitla',
    name: 'Maashitla Securities',
    match: ['maashitla'],
    url: 'https://www.maashitla.com/allotment-status/public-issues',
    companySelect: '#ddlCompany, select[name="company"]',
    panInput: '#txtPan, input[name="search"]',
    submit: 'button[type="submit"], #btnSearch',
    result: '#tableData, table',
    captcha: 'none',
  },

  purva: {
    key: 'purva',
    name: 'Purva Sharegistry',
    match: ['purva'],
    url: 'https://www.purvashare.com/investor-service/ipo-query',
    companySelect: 'select[name="company_id"]',
    panInput: 'input[name="panNumber"]',
    submit: 'button[type="submit"], input[type="submit"]',
    result: 'table, .result',
    captcha: 'none',
  },

  cameo: {
    key: 'cameo',
    name: 'Cameo Corporate Services',
    match: ['cameo'],
    url: 'https://ipo.cameoindia.com/',
    companySelect: 'select',
    panInput: 'input[formcontrolname="pan"], #pan',
    submit: 'button[type="submit"]',
    result: 'table, .result-container',
    captcha: 'none',
  },
};

function loadOverrides(): Record<string, Partial<BrowserProfile>> {
  const file = path.join(config.dataDir, 'registrar-profiles.json');
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Partial<BrowserProfile>>;
    log.info(`applied selector overrides for: ${Object.keys(parsed).join(', ') || 'nothing'}`);
    return parsed;
  } catch (err) {
    log.warn(`ignoring malformed registrar-profiles.json: ${(err as Error).message}`);
    return {};
  }
}

export function browserProfiles(): BrowserProfile[] {
  const overrides = loadOverrides();
  return Object.values(DEFAULTS).map((base) => ({ ...base, ...(overrides[base.key] ?? {}) }));
}
