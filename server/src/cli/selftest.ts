/**
 * End-to-end check of the allotment reporting path against a scratch account:
 * PAN storage -> registrar sweep -> aggregate summary -> notification fan-out.
 *
 *   npm run selftest -w server
 *
 * Uses a throwaway account and deletes it afterwards, so it is safe to run against a live
 * database. Registrar lookups are real, so the PANs used here simply return "not applied".
 */
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { runLifecycleAlerts } from '../jobs/lifecycle.js';
import { checkAllotmentForAccount, ensureRegistrar, summaryHeadline } from '../services/allotment.js';
import { getIpo, listIpos } from '../services/ipoStore.js';
import { notify } from '../services/notify.js';
import { encryptPan, generateSyncKey, hashPan } from '../util/crypto.js';

const PANS = [
  { pan: 'AAAPZ1234C', label: 'Self' },
  { pan: 'BBBPZ5678D', label: 'Spouse' },
  { pan: 'CCCPZ9012E', label: 'Father' },
];

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${label}`);
  if (!condition) {
    failures += 1;
    if (detail !== undefined) console.log('        ', detail);
  }
}

async function main() {
  const accountId = crypto.randomUUID();
  db.prepare('INSERT INTO accounts (id, sync_key) VALUES (?, ?)').run(accountId, generateSyncKey());
  db.prepare('INSERT INTO alert_prefs (account_id) VALUES (?)').run(accountId);

  try {
    console.log('\n1. PAN storage');
    for (const { pan, label } of PANS) {
      db.prepare(
        'INSERT INTO pans (id, account_id, label, pan_enc, pan_hash) VALUES (?, ?, ?, ?, ?)',
      ).run(crypto.randomUUID(), accountId, label, encryptPan(pan), hashPan(pan));
    }
    const stored = db.prepare('SELECT pan_enc FROM pans WHERE account_id = ?').all(accountId) as {
      pan_enc: string;
    }[];
    check(`${PANS.length} PANs saved`, stored.length === PANS.length);
    check(
      'ciphertext never contains the raw PAN',
      stored.every((row) => !row.pan_enc.includes('AAAPZ')),
    );

    console.log('\n2. Registrar resolution');
    // Registrars only list an issue for a short window around its allotment, so scan every
    // recent IPO rather than assuming the newest few are the ones currently open for lookup.
    const candidates = listIpos().filter((i) => i.status === 'allotment' || i.status === 'listed');
    let resolved = null;
    for (const candidate of candidates.slice(0, 40)) {
      const withRegistrar = await ensureRegistrar(candidate);
      if (withRegistrar.registrar_key && withRegistrar.registrar_code) {
        resolved = withRegistrar;
        break;
      }
    }

    if (resolved) {
      check('resolved an IPO to a registrar + company code', true);
      console.log(`        ${resolved.name} -> ${resolved.registrar_key} #${resolved.registrar_code}`);
    } else {
      // Not a failure: between allotment windows no registrar has any issue open for lookup.
      console.log('  SKIP  no registrar currently lists any of the stored IPOs');
    }

    console.log('\n3. Sweep every PAN in one pass');
    const target = resolved ?? candidates[0];
    if (!target) {
      check('an IPO exists to check', false, 'database is empty — run `npm run sync -w server` first');
      return;
    }
    const summary = await checkAllotmentForAccount(accountId, target.id);
    check('every saved PAN produced a result', summary.results.length === PANS.length, summary.results);
    check('summary totals are consistent', summary.allottedAccounts <= summary.totalAccounts);
    check(
      'results are persisted',
      (db.prepare('SELECT COUNT(*) AS n FROM allotment_results WHERE account_id = ?').get(accountId) as {
        n: number;
      }).n === PANS.length,
    );
    console.log(`        headline: "${summaryHeadline(summary)}"`);

    console.log('\n4. Notification fan-out');
    const sent = await notify({
      accountId,
      ipoId: target.id,
      kind: 'allotment_result',
      title: `Allotment: ${target.name}`,
      body: summaryHeadline(summary),
    });
    check('notification accepted', sent);
    const inbox = db
      .prepare('SELECT title, body FROM notifications WHERE account_id = ?')
      .all(accountId) as { title: string; body: string }[];
    check('notification stored in the in-app inbox', inbox.length === 1, inbox);

    console.log('\n5. Preference gating');
    db.prepare('UPDATE alert_prefs SET allotment_out = 0 WHERE account_id = ?').run(accountId);
    const suppressed = await notify({
      accountId,
      ipoId: target.id,
      kind: 'allotment_result',
      title: 'Should not appear',
      body: 'muted',
    });
    check('muted category is not delivered', suppressed === false);

    console.log('\n6. Lifecycle alerts run without error');
    await runLifecycleAlerts();
    check('lifecycle pass completed', true);
  } finally {
    // Cascades through pans, results and notifications.
    db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
    console.log('\nscratch account removed');
  }

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error('\nselftest crashed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.close());
