import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from '../config.js';
import { BROWSER_UA } from '../util/http.js';
import { logger } from '../util/logger.js';

const log = logger('browser');

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: config.browserHeadless,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
      })
      .then((b) => {
        log.info('chromium launched');
        b.on('disconnected', () => {
          browserPromise = null;
        });
        return b;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}

/**
 * Registrar sites sit behind Imperva/Akamai bot walls that reject obviously automated
 * clients, so contexts get a realistic UA, an Indian locale, and the `webdriver` flag removed.
 */
async function newContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: BROWSER_UA,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    viewport: { width: 1366, height: 900 },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return ctx;
}

/**
 * Browser work is serialised through a single-slot queue. Registrar sites throttle
 * aggressively, and a bank of parallel Chromium pages is the fastest way to get IP-banned.
 */
let queue: Promise<unknown> = Promise.resolve();

export function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const ctx = await newContext();
    const page = await ctx.newPage();
    try {
      page.setDefaultTimeout(30_000);
      return await fn(page);
    } finally {
      await ctx.close().catch(() => {});
    }
  };

  const result = queue.then(run, run);
  // Keep the chain alive even when a job throws, otherwise every later job rejects.
  queue = result.catch(() => {});
  return result;
}
