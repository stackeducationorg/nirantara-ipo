import type { Page } from 'playwright';
import { config } from '../config.js';
import { logger } from '../util/logger.js';
import { toInt } from '../util/parse.js';
import { withPage } from './browser.js';
import type { AllotmentLookup, AllotmentQuery, RegistrarAdapter, RegistrarCompany } from './types.js';
import { RegistrarError } from './types.js';

const log = logger('registrar');

export interface BrowserProfile {
  key: string;
  name: string;
  match: string[];
  url: string;
  /** `<select>` listing the issues open for lookup. */
  companySelect: string;
  panInput: string;
  submit: string;
  /** Element that holds the result table/message once the lookup completes. */
  result: string;
  /**
   * Some registrars ask you to pick a search mode (PAN / application no / DP-CL id) before
   * the PAN field is usable.
   */
  searchType?: { selector: string; match: RegExp };
  /**
   * `none`  – no challenge.
   * `arith` – a readable "4 + 7 =" sum rendered as text.
   * `image` – a bitmap challenge; unsolvable without OCR, so we surface a clear error.
   */
  captcha?: 'none' | 'arith' | 'image';
  captchaText?: string;
  captchaInput?: string;
}

/** Cache dropdown contents briefly — they change at most a few times a day. */
const companyCache = new Map<string, { at: number; items: RegistrarCompany[] }>();
const COMPANY_TTL_MS = 30 * 60 * 1000;

async function readCompanies(page: Page, profile: BrowserProfile): Promise<RegistrarCompany[]> {
  await page.goto(profile.url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(profile.companySelect, { timeout: 25_000 });

  // Options are often injected after an XHR, so wait until the list has more than a placeholder.
  await page
    .waitForFunction(
      (sel) => (document.querySelector(sel) as HTMLSelectElement | null)?.options.length ?? 0 > 1,
      profile.companySelect,
      { timeout: 15_000 },
    )
    .catch(() => {});

  return page.$$eval(`${profile.companySelect} option`, (opts) =>
    opts
      .map((o) => ({ code: (o as HTMLOptionElement).value.trim(), name: (o.textContent ?? '').trim() }))
      .filter((o) => o.code && o.name && !/^-{0,2}\s*select/i.test(o.name)),
  );
}

async function solveCaptcha(page: Page, profile: BrowserProfile): Promise<void> {
  if (!profile.captcha || profile.captcha === 'none') return;

  if (profile.captcha === 'image') {
    throw new RegistrarError(
      `${profile.name} protects allotment lookup with an image captcha; automatic checking is not available`,
      false,
    );
  }

  if (!profile.captchaText || !profile.captchaInput) {
    throw new RegistrarError(`${profile.name} captcha profile is incomplete`, false);
  }

  const text = (await page.textContent(profile.captchaText))?.trim() ?? '';
  const sum = text.match(/(\d+)\s*([+\-*])\s*(\d+)/);
  if (!sum) throw new RegistrarError(`Could not read ${profile.name} captcha ("${text}")`);

  const [, a, op, b] = sum;
  const x = Number(a);
  const y = Number(b);
  const answer = op === '+' ? x + y : op === '-' ? x - y : x * y;
  await page.fill(profile.captchaInput, String(answer));
}

/** Reads the result panel and classifies it into an allotment outcome. */
async function readResult(page: Page, profile: BrowserProfile): Promise<AllotmentLookup> {
  const text = ((await page.textContent(profile.result).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();

  if (!text) {
    return { status: 'error', message: 'Registrar returned an empty result panel' };
  }
  if (/no (?:record|data|allotment|application)|not found|invalid pan/i.test(text)) {
    return { status: 'not_applied', message: 'No application found for this PAN', raw: text };
  }
  if (/not\s*(?:been\s*)?(?:allot|allocat)/i.test(text)) {
    return { status: 'not_allotted', allottedQty: 0, message: 'Applied, no allotment', raw: text };
  }

  // Grab the numbers the registrars label consistently across their result tables.
  const allotted = toInt(text.match(/allot(?:ted|ed)[^0-9-]{0,25}(\d[\d,]*)/i)?.[1]);
  const applied = toInt(text.match(/appli(?:ed|cation)[^0-9-]{0,25}(\d[\d,]*)/i)?.[1]);
  const name = text.match(/name[^a-z]{0,5}([A-Z][A-Za-z .]{2,60})/)?.[1]?.trim() ?? null;

  if (allotted === null) {
    return { status: 'error', message: `Could not parse result: ${text.slice(0, 180)}`, raw: text };
  }

  return {
    status: allotted > 0 ? 'allotted' : 'not_allotted',
    allottedQty: allotted,
    appliedQty: applied,
    nameOnRecord: name,
    raw: text,
  };
}

export function createBrowserAdapter(profile: BrowserProfile): RegistrarAdapter {
  return {
    key: profile.key,
    name: profile.name,
    driver: 'browser',
    match: profile.match,

    async listCompanies() {
      if (!config.enableBrowserRegistrars) return [];

      const cached = companyCache.get(profile.key);
      if (cached && Date.now() - cached.at < COMPANY_TTL_MS) return cached.items;

      const items = await withPage((page) => readCompanies(page, profile));
      companyCache.set(profile.key, { at: Date.now(), items });
      log.info(`${profile.key}: ${items.length} companies open for lookup`);
      return items;
    },

    async check({ companyCode, pan }: AllotmentQuery) {
      if (!config.enableBrowserRegistrars) {
        throw new RegistrarError(`${profile.name} lookups are disabled on this server`, false);
      }

      return withPage(async (page) => {
        await page.goto(profile.url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(profile.companySelect, { timeout: 25_000 });
        await page.selectOption(profile.companySelect, companyCode);

        if (profile.searchType) {
          const value = await page.$$eval(
            `${profile.searchType.selector} option`,
            (opts) => opts.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? '' })),
          );
          const hit = value.find((o) => profile.searchType!.match.test(o.t) || profile.searchType!.match.test(o.v));
          if (hit) await page.selectOption(profile.searchType.selector, hit.v);
        }

        await page.waitForSelector(profile.panInput, { timeout: 15_000 });
        await page.fill(profile.panInput, pan);
        await solveCaptcha(page, profile);

        await page.click(profile.submit);
        await page
          .waitForSelector(profile.result, { timeout: 30_000 })
          .catch(() => {
            throw new RegistrarError(`${profile.name} did not return a result in time`);
          });

        return readResult(page, profile);
      });
    },
  };
}
