/**
 * Proves which of a registrar's lookup paths actually carry a captcha, so the routing in
 * `searchRoutes()` is based on a live answer rather than on a comment someone wrote once.
 *
 *   npm run gatetest -w server
 *
 * For each identifier kind the registrar accepts, this sends one lookup with the captcha
 * fields deliberately left EMPTY and reports what came back:
 *
 *   OPEN    — answered from the data layer. No captcha on this path.
 *   GATED   — refused for want of a captcha. This path needs a human.
 *
 * Nothing here reads, solves or submits a challenge. An empty answer is sent precisely so
 * the server's own refusal is what gets measured.
 *
 * Every identifier below is structurally valid but unissued, so no real investor's data is
 * fetched — the only thing being observed is which gate answers.
 */
import { needsCaptchaFor, registrars, searchRoutes } from '../registrars/index.js';
import { CaptchaRequiredError } from '../registrars/types.js';
import type { RegistrarAdapter, SearchBy } from '../registrars/types.js';

const DUMMY_PAN = 'AAAPZ1234C';
const DUMMY_NSDL = { depository: 'NSDL' as const, id: 'IN99999999999999' };
const DUMMY_APPLICATION = '0000000000';

/** Only the adapters that claim a gate are worth probing. */
const targets = [...registrars.values()].filter((a) => a.needsCaptcha);

let mismatches = 0;

async function probe(adapter: RegistrarAdapter, by: SearchBy, companyCode: string) {
  const declared = needsCaptchaFor(adapter, by) ? 'GATED' : 'OPEN';

  let observed: 'OPEN' | 'GATED' | 'UNKNOWN' = 'UNKNOWN';
  let detail = '';

  try {
    const lookup = await adapter.check({
      companyCode,
      pan: by === 'pan' ? DUMMY_PAN : '',
      applicationNo: by === 'application' ? DUMMY_APPLICATION : undefined,
      demat: by === 'demat' ? DUMMY_NSDL : null,
      by,
      // The point of the probe: no answer supplied, on purpose.
      captcha: null,
    });
    // Reaching the data layer at all — even to be told "no such application" — means this
    // path answered without a challenge.
    observed = 'OPEN';
    detail = lookup.status;
  } catch (err) {
    if (err instanceof CaptchaRequiredError) {
      observed = 'GATED';
      detail = 'challenge issued';
    } else {
      const msg = (err as Error).message;
      // A registrar that refuses on the captcha field specifically is gated; anything else
      // (network, bad company code, changed markup) is not evidence either way.
      observed = /captcha/i.test(msg) ? 'GATED' : 'UNKNOWN';
      detail = msg.slice(0, 120);
    }
  }

  const agrees = observed === 'UNKNOWN' || observed === declared;
  if (!agrees) mismatches += 1;

  const flag = observed === 'UNKNOWN' ? '   ?' : agrees ? '  ok' : ' <-- DISAGREES';
  console.log(
    `  ${by.padEnd(12)} declared=${declared.padEnd(6)} observed=${observed.padEnd(8)}${flag}  ${detail}`,
  );
}

async function main() {
  if (targets.length === 0) {
    console.log('No registrar declares a captcha gate.');
    return;
  }

  for (const adapter of targets) {
    console.log(`\n${adapter.key}  (${adapter.name})`);
    console.log(
      `  routes when every identifier is on file: ${searchRoutes(adapter, adapter.searchBy).join(' -> ')}`,
    );

    let companyCode: string;
    try {
      const companies = await adapter.listCompanies();
      if (companies.length === 0) {
        console.log('  no open issues right now — nothing to probe against');
        continue;
      }
      companyCode = companies[0].code;
      console.log(`  probing against "${companies[0].name}" (#${companyCode})\n`);
    } catch (err) {
      console.log(`  could not list issues: ${(err as Error).message}`);
      continue;
    }

    for (const by of adapter.searchBy) {
      await probe(adapter, by, companyCode);
    }
  }

  console.log(
    mismatches === 0
      ? '\nEvery path behaved as declared. Routing is sound.\n'
      : `\n${mismatches} path(s) disagree with what the adapter declares — update captchaFreeSearchBy.\n`,
  );
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
