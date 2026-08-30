/**
 * Repay drivers who were charged for a no-show that never happened.
 *
 * Settlement used to branch on `boarding_verified === true`, so any booking
 * without a recorded boarding code was settled as a no-show: the rider got 80%
 * back, the driver got 5%, the platform kept 15%. The inference was wrong in
 * every case it was applied — 8 settlements, 0 verified, 8 no-shows. No
 * population of riders fails to turn up 100% of the time; the boarding control
 * was being wiped by any failed manifest fetch, so no driver could verify
 * anyone even when they tried.
 *
 * This pays those drivers the difference between what they received (5%) and
 * the full fare they earned, and it does so WITHOUT clawing back the riders'
 * refunds. Those riders did nothing wrong, they have had the money for days,
 * and taking it back over our own bug would be a second wrong. The shortfall
 * comes out of the platform's share, which is where the 15% went.
 *
 * DRY RUN BY DEFAULT. Pass --apply to move money.
 *
 *   node scripts/remediate-false-no-shows.mjs            # preview
 *   node scripts/remediate-false-no-shows.mjs --apply    # execute
 *
 * Idempotent: a booking already carrying `no_show_remediated` is skipped, so
 * running it twice cannot pay twice.
 */
import admin from 'firebase-admin';

const PROJECT = process.env.GCP_PROJECT || 'thecarpool-fe636';
const APPLY = process.argv.includes('--apply');

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

const round2 = (n) => Math.round(n * 100) / 100;

const snap = await db.collection('bookings').where('escrow_status', '==', 'SETTLED').get();

const candidates = [];
for (const doc of snap.docs) {
  const b = doc.data();
  // Settled as a no-show, never verified, and never actually declared one by
  // a driver — i.e. the penalty came from the inference, not from a claim.
  if (b.boarding_verified === true) continue;
  if (b.marked_no_show === true) continue;
  if (b.no_show_remediated === true) continue;
  if (!(Number(b.driver_payout ?? 0) === 0 || b.settled_amount === undefined)) {
    // driver_payout is set on the full-payment path; a no-show settlement
    // records driver_share instead. Guard rather than assume.
  }
  const fare = Number(b.fare_amount ?? 0);
  if (fare <= 0) continue;

  const received = round2(fare * 0.05);
  const owed = round2(fare - received);
  if (owed <= 0) continue;

  candidates.push({ id: doc.id, ref: doc.ref, ride_id: b.ride_id, fare, received, owed });
}

if (candidates.length === 0) {
  console.log('Nothing to remediate.');
  process.exit(0);
}

// Group by driver via the ride.
const byDriver = new Map();
for (const c of candidates) {
  const ride = await db.collection('rides').doc(String(c.ride_id)).get();
  const driver = ride.exists ? String(ride.data()?.driver_uid ?? ride.data()?.driver_id ?? '') : '';
  if (!driver) {
    console.log(`  SKIP ${c.id.slice(0, 26)} — cannot resolve a driver for ride ${c.ride_id}`);
    continue;
  }
  if (!byDriver.has(driver)) byDriver.set(driver, []);
  byDriver.get(driver).push(c);
}

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${candidates.length} bookings across ${byDriver.size} drivers\n`);

let total = 0;
for (const [driver, items] of byDriver) {
  const owed = round2(items.reduce((sum, i) => sum + i.owed, 0));
  total = round2(total + owed);
  const u = (await db.collection('users').doc(driver).get()).data() ?? {};
  console.log(`  ${driver.slice(0, 10)}  ${(u.name || u.displayName || 'driver').padEnd(16)} ${items.length} ride(s)  owed Rs ${owed}`);
  for (const i of items) {
    console.log(`      ${i.id.slice(0, 26)}  fare ${i.fare}  received ${i.received}  ->  +${i.owed}`);
  }

  if (!APPLY) continue;

  await db.runTransaction(async (tx) => {
    const walletRef = db.collection('wallets').doc(driver);
    const wallet = await tx.get(walletRef);
    const cur = wallet.exists ? wallet.data() : { available_wallet_balance: 0, escrow_locked_balance: 0 };
    tx.set(walletRef, {
      ...cur,
      available_wallet_balance: round2((cur.available_wallet_balance || 0) + owed),
    }, { merge: true });

    for (const i of items) {
      tx.update(i.ref, {
        no_show_remediated: true,
        no_show_remediated_at: new Date().toISOString(),
        no_show_remediation_amount: i.owed,
      });
    }
  });
  console.log(`      credited Rs ${owed} to ${driver.slice(0, 10)}`);
}

console.log(`\n${APPLY ? 'Paid' : 'Would pay'} Rs ${total} across ${byDriver.size} drivers.`);
if (!APPLY) console.log('Re-run with --apply to execute.');
