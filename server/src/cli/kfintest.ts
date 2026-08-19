/**
 * Exercises the KFin response parser against the real payload shapes.
 *
 *   npm run kfintest -w server
 *
 * The sample values below are anonymised — only the field *names* matter, and those are what
 * the parser keys on.
 */
import { parseKfinRecord } from '../registrars/kfintech.js';

const cases: { label: string; record: Record<string, unknown>; expect: Record<string, unknown> }[] = [
  {
    label: 'applied but not allotted (the shape seen in production)',
    record: {
      All_Shares: '0',
      App_Shares: '154',
      Appln_No: 'GROWWxxxxxxxxxxx',
      DP_CLID: '1208xxxxxxxxxxxx',
      Name: 'MR. A B C',
      Pan_No: 'AAAPZ1234C',
    },
    expect: { status: 'not_allotted', allottedQty: 0, appliedQty: 154 },
  },
  {
    label: 'allotted',
    record: { All_Shares: '154', App_Shares: '154', Name: 'MR. A B C', Appln_No: 'X1' },
    expect: { status: 'allotted', allottedQty: 154, appliedQty: 154 },
  },
  {
    label: 'partial allotment',
    record: { All_Shares: '77', App_Shares: '308' },
    expect: { status: 'allotted', allottedQty: 77, appliedQty: 308 },
  },
  {
    label: 'alternate field naming',
    record: { Allotted_Shares: '50', Applied_Shares: '100' },
    expect: { status: 'allotted', allottedQty: 50, appliedQty: 100 },
  },
  {
    label: 'genuinely unreadable shape',
    record: { Foo: 'bar' },
    expect: { status: 'error' },
  },
];

let failures = 0;

for (const { label, record, expect } of cases) {
  const got = parseKfinRecord(record, 'TESTCODE');
  const mismatches = Object.entries(expect).filter(
    ([key, value]) => (got as unknown as Record<string, unknown>)[key] !== value,
  );

  if (mismatches.length === 0) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    for (const [key, value] of mismatches) {
      console.log(`          ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify((got as unknown as Record<string, unknown>)[key])}`);
    }
  }
}

// The name should survive so the PAN book can adopt it.
const named = parseKfinRecord({ All_Shares: '0', App_Shares: '10', Name: '  MR. A B C  ' });
if (named.nameOnRecord === 'MR. A B C') console.log('  PASS  investor name is trimmed and kept');
else {
  failures += 1;
  console.log(`  FAIL  name handling: got ${JSON.stringify(named.nameOnRecord)}`);
}

// Nothing sensitive should be echoed back for storage.
const noRaw = parseKfinRecord({ All_Shares: '0', App_Shares: '10', Pan_No: 'AAAPZ1234C' });
if (noRaw.raw === undefined) console.log('  PASS  raw payload is not returned for storage');
else {
  failures += 1;
  console.log('  FAIL  raw payload leaked into the result');
}

console.log(failures === 0 ? '\nAll KFin parser checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exitCode = failures === 0 ? 0 : 1;
