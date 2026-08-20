/**
 * Live smoke test for every HTTP registrar adapter: fetches each one's open issue list and
 * runs one lookup against a deliberately invalid PAN, which must come back as `not_applied`.
 *
 *   npm run registrartest -w server
 *
 * This talks to the real registrars, so it is a health check rather than a unit test —
 * a failure here usually means a registrar changed its site, not that the code regressed.
 */
import { registrars } from '../registrars/index.js';
import type { RegistrarAdapter } from '../registrars/types.js';

// Structurally valid but unissued, so no real investor's data is ever fetched.
const DUMMY_PAN = 'AAAPZ1234C';

let failures = 0;
let warnings = 0;

function pass(label: string) {
  console.log(`  PASS  ${label}`);
}
function fail(label: string, detail?: unknown) {
  failures += 1;
  console.log(`  FAIL  ${label}`);
  if (detail !== undefined) console.log(`        ${String(detail).slice(0, 220)}`);
}
function warn(label: string) {
  warnings += 1;
  console.log(`  WARN  ${label}`);
}

async function exercise(adapter: RegistrarAdapter) {
  console.log(`\n${adapter.key}  (${adapter.name})`);

  let companies;
  try {
    companies = await adapter.listCompanies();
  } catch (err) {
    fail('listCompanies', (err as Error).message);
    return;
  }

  if (companies.length === 0) {
    // Legitimate between issues, so this is not counted as a failure.
    warn('listCompanies returned 0 issues — none open right now?');
    return;
  }
  pass(`listCompanies -> ${companies.length} issues`);
  console.log(`        e.g. ${companies.slice(0, 2).map((c) => `${c.code}="${c.name}"`).join(', ')}`);

  try {
    const result = await adapter.check({ companyCode: companies[0].code, pan: DUMMY_PAN });
    if (result.status === 'not_applied') {
      pass(`check(unissued PAN) -> not_applied`);
    } else if (result.status === 'error') {
      fail(`check(unissued PAN) -> error`, result.message);
    } else {
      // Anything else means the response was misread — an unissued PAN cannot have applied.
      fail(`check(unissued PAN) -> ${result.status}`, JSON.stringify(result));
    }
  } catch (err) {
    fail('check', (err as Error).message);
  }
}

const only = process.argv.slice(2);
const targets = [...registrars.values()].filter(
  (a) => a.driver === 'http' && (only.length === 0 || only.includes(a.key)),
);

console.log(`Testing ${targets.length} HTTP registrar(s) with PAN ${DUMMY_PAN}`);

for (const adapter of targets) {
  await exercise(adapter);
}

console.log(
  failures === 0
    ? `\nAll HTTP registrars responded correctly${warnings ? ` (${warnings} warning(s))` : ''}.\n`
    : `\n${failures} check(s) failed, ${warnings} warning(s).\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
