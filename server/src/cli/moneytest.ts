/**
 * Verifies the money ledger's settlement maths against synthetic allotment results:
 * full allotment, partial allotment and no allotment, plus the refund confirmation flow.
 *
 *   npm run moneytest -w server
 *
 * Uses a scratch account that is deleted afterwards, so it is safe against a live database.
 */
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import {
  listApplications,
  markRefund,
  moneyByIpo,
  moneySummary,
  reconcileFromAllotment,
  saveApplication,
} from '../services/applications.js';
import { listIpos } from '../services/ipoStore.js';
import { encryptPan, generateSyncKey, hashPan } from '../util/crypto.js';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures += 1;
    if (detail !== undefined) console.log('        ', JSON.stringify(detail).slice(0, 300));
  }
}

const accountId = crypto.randomUUID();
db.prepare('INSERT INTO accounts (id, sync_key) VALUES (?, ?)').run(accountId, generateSyncKey());
db.prepare('INSERT INTO alert_prefs (account_id) VALUES (?)').run(accountId);

try {
  const ipo = listIpos().find((i) => i.lot_size && i.price_max);
  if (!ipo) throw new Error('no IPO with a lot size and price — run `npm run sync -w server` first');

  const lot = ipo.lot_size!;
  const price = ipo.price_max!;
  console.log(`\nIPO: ${ipo.name}  lot=${lot}  cut-off=${price}  per lot=${lot * price}\n`);

  // Three accounts, applying 2 / 1 / 1 lots.
  const panIds: string[] = [];
  const plans = [
    { pan: 'AAAPZ1234C', label: 'Self', lots: 2 },
    { pan: 'BBBPZ5678D', label: 'Spouse', lots: 1 },
    { pan: 'CCCPZ9012E', label: 'Father', lots: 1 },
  ];

  for (const plan of plans) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO pans (id, account_id, label, pan_enc, pan_hash) VALUES (?, ?, ?, ?, ?)').run(
      id,
      accountId,
      plan.label,
      encryptPan(plan.pan),
      hashPan(plan.pan),
    );
    panIds.push(id);
    saveApplication(accountId, ipo.id, id, { lots: plan.lots });
  }

  const totalBlocked = lot * price * 4;
  check('blocked total across 4 lots', moneySummary(accountId).totalBlocked === totalBlocked, moneySummary(accountId));

  // Synthetic registrar outcomes: full, partial, none.
  const outcomes = [
    { panId: panIds[0], status: 'allotted', allotted: lot * 2 }, // applied 2 lots, got both
    { panId: panIds[1], status: 'allotted', allotted: lot }, // applied 1 lot, got it
    { panId: panIds[2], status: 'not_allotted', allotted: 0 }, // applied 1 lot, got nothing
  ];

  for (const o of outcomes) {
    db.prepare(
      `INSERT INTO allotment_results (id, ipo_id, pan_id, account_id, status, applied_qty, allotted_qty, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(crypto.randomUUID(), ipo.id, o.panId, accountId, o.status, lot, o.allotted, o.allotted * price);
  }

  const reconciled = reconcileFromAllotment(accountId, ipo.id);
  check('all three applications reconciled', reconciled === 3, reconciled);

  const apps = listApplications(accountId, ipo.id);
  const byPan = new Map(apps.map((a) => [a.panId, a]));

  const full = byPan.get(panIds[0])!;
  check('fully allotted: debited equals the whole block', full.amountDebited === lot * 2 * price, full);
  check('fully allotted: nothing to refund', full.refundAmount === 0, full);
  check('fully allotted: status is debited', full.refundStatus === 'debited', full.refundStatus);

  const single = byPan.get(panIds[1])!;
  check('single lot allotted: debited correct', single.amountDebited === lot * price, single);
  check('single lot allotted: no refund', single.refundStatus === 'debited', single.refundStatus);

  const none = byPan.get(panIds[2])!;
  check('not allotted: nothing debited', none.amountDebited === 0, none);
  check('not allotted: full amount refundable', none.refundAmount === lot * price, none);
  check('not allotted: refund pending', none.refundStatus === 'refund_pending', none.refundStatus);

  const afterSettle = moneySummary(accountId);
  check('invested equals what was actually allotted', afterSettle.totalInvested === lot * 3 * price, afterSettle);
  check('refund pending equals the unallotted lot', afterSettle.refundPending === lot * price, afterSettle);
  check('nothing still counted as blocked', afterSettle.totalBlocked === 0, afterSettle);

  // Confirming the refund moves it from pending to received.
  markRefund(accountId, none.id, true);
  const confirmed = moneySummary(accountId);
  check('confirming a refund clears pending', confirmed.refundPending === 0, confirmed);
  check('confirming a refund records it as received', confirmed.refundReceived === lot * price, confirmed);

  // A re-check of allotment must not undo a refund the user already confirmed.
  reconcileFromAllotment(accountId, ipo.id);
  const afterRecheck = listApplications(accountId, ipo.id).find((a) => a.panId === panIds[2])!;
  check('re-checking does not reset a confirmed refund', afterRecheck.refundStatus === 'refund_received', afterRecheck.refundStatus);

  // A fully-allotted application has no refund to confirm.
  let rejected = false;
  try {
    markRefund(accountId, full.id, true);
  } catch {
    rejected = true;
  }
  check('cannot mark a refund on a fully allotted application', rejected);

  const rollup = moneyByIpo(accountId);
  check('rollup shows the IPO', rollup.length === 1 && rollup[0].ipoId === ipo.id, rollup);
  check('rollup allotted share count', rollup[0]?.allottedShares === lot * 3, rollup[0]);

  console.log(
    `\n  settled: invested=${confirmed.totalInvested}  refunded=${confirmed.refundReceived}  blocked=${confirmed.totalBlocked}`,
  );
} finally {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  console.log('\nscratch account removed');
}

console.log(failures === 0 ? '\nAll money settlement checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exitCode = failures === 0 ? 0 : 1;
db.close();
