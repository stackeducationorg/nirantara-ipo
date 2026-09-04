import { db } from '../db/index.js';
import { fetchBidVerifySymbols } from '../sources/nse.js';
import { logger } from '../util/logger.js';

const log = logger('nse-symbols');

/**
 * Company names and ticker symbols only line up once punctuation, spacing and the corporate
 * tail are gone: "Lumino Industries Limited" -> LUMINOINDUSTRIESLIMITED, which the symbol
 * LUMINO is a prefix of.
 */
function normalise(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Attaches NSE ticker symbols to the issues they belong to.
 *
 * NSE publishes bare symbols with no issuer name attached, so the join has to be made on the
 * name. A symbol is accepted only when exactly one issue matches it: two candidates means the
 * guess could be wrong, and a wrong symbol would send an applicant to another company's
 * allotment. An unmatched issue simply keeps a null symbol and shows no NSE option.
 */
export async function syncNseSymbols(): Promise<{ matched: number; ambiguous: number; unmatched: number }> {
  const symbols = await fetchBidVerifySymbols();
  if (symbols.length === 0) return { matched: 0, ambiguous: 0, unmatched: 0 };

  // Only issues that could plausibly be in NSE's window — it drops them 10 days after close.
  const candidates = db
    .prepare(
      `SELECT id, name FROM ipos
        WHERE close_date IS NULL OR date(close_date, '+15 day') >= date('now')`,
    )
    .all() as { id: string; name: string }[];

  const prepared = candidates.map((row) => ({ ...row, key: normalise(row.name) }));
  const update = db.prepare('UPDATE ipos SET nse_symbol = ? WHERE id = ?');

  let matched = 0;
  let ambiguous = 0;

  const run = db.transaction(() => {
    for (const symbol of symbols) {
      const hits = prepared.filter((row) => row.key.startsWith(symbol));

      if (hits.length === 1) {
        update.run(symbol, hits[0].id);
        matched += 1;
      } else if (hits.length > 1) {
        // Never guess between them — a wrong symbol is worse than no symbol at all.
        ambiguous += 1;
        log.warn(`symbol ${symbol} matches ${hits.length} issues (${hits.map((h) => h.name).join(', ')}) — skipped`);
      }
    }
  });
  run();

  const unmatched = symbols.length - matched - ambiguous;
  log.info(`matched ${matched}/${symbols.length} NSE symbol(s) (${ambiguous} ambiguous, ${unmatched} unmatched)`);
  return { matched, ambiguous, unmatched };
}
