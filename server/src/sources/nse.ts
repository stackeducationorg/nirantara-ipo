import { getJson } from '../util/http.js';
import { logger } from '../util/logger.js';

const log = logger('nse');

/**
 * NSE's own bid/allotment verification page. Investors reach it directly; the app only ever
 * points people at it, it never posts to it.
 *
 * The lookup behind this page (POST /api/ipo-bid-verification-details) is wrapped in
 * grecaptcha.execute() and carries a reCAPTCHA v3 token on every submit, so it cannot be
 * called from a server without minting tokens. The symbol list below is the one part that is
 * plainly public — a bare GET, no token — which is why it is the only NSE call made here.
 */
export const NSE_BID_VERIFY_URL =
  'https://www.nseindia.com/invest/check-trades-bids-verify-ipo-bids';

const SYMBOL_LIST_URL = 'https://www.nseindia.com/api/ipo-bid-master';

/**
 * The symbols NSE will currently answer bid queries for — i.e. issues inside the window that
 * runs from T+1 on the first bid to 10 days after the issue closes. Anything not on this list
 * cannot be checked on NSE at all, whatever the app knows about it.
 */
export async function fetchBidVerifySymbols(): Promise<string[]> {
  const symbols = await getJson<string[]>(SYMBOL_LIST_URL, {
    headers: { Accept: 'application/json', Referer: NSE_BID_VERIFY_URL },
  });

  if (!Array.isArray(symbols)) {
    log.warn('symbol list was not an array — ignoring this sync');
    return [];
  }

  const clean = symbols.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  log.debug(`bid verification open for ${clean.length} symbol(s)`);
  return clean.map((s) => s.trim().toUpperCase());
}
