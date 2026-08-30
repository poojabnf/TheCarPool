/**
 * One-off remediation: riders who paid, were never approved, and lost out.
 *
 * Seven bookings reached a state the code no longer produces. Each was still
 * REQUESTED — the driver never accepted or declined — on a ride that was then
 * marked COMPLETED. Two things could follow:
 *
 *   - still HELD:    money sitting in escrow with nothing left to resolve it.
 *   - already SETTLED as a no-show: 80% returned, 20% kept as a penalty for
 *     failing to travel on a ride they were never given a seat on.
 *
 * Both are made whole here: refunded to the full amount paid. The fix in
 * routes/rides.ts stops new ones occurring; this repairs the existing ones.
 *
 * DRY RUN BY DEFAULT. Pass --apply to move money.
 *
 *   FIREBASE_SA_EMAIL=953521578640-compute@developer.gserviceaccount.com \
 *     node scripts/remediate-unapproved-bookings.mjs            # preview
 *     node scripts/remediate-unapproved-bookings.mjs --apply    # execute
 *
 * Refunds go to the WALLET, deliberately, even for card payments. A refund to
 * source needs a live Razorpay call per booking, and several of these are old
 * enough that the payment may no longer be refundable; a wallet credit is
 * immediate, cannot fail halfway, and is verifiable from the ledger. Riders
 * who want it off the platform are a support conversation, not a script.
 */
import admin from 'firebase-admin';

const PROJECT = process.env.GCP_PROJECT || 'thecarpool-fe636';
const APPLY = process.argv.includes('--apply');

if (process.env.GOOGLE_APPLICATION_CREDENTIALS) admin.initializeApp({ projectId: PROJECT });
else if (process.env.FIREBASE_SA_EMAIL) {
  admin.initializeApp({ projectId: PROJECT, serviceAccountId: process.env.FIREBASE_SA_EMAIL });
} else admin.initializeApp({ projectId: PROJECT });

const db = admin.firestore();
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

(async () => {
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — unapproved-booking remediation\n`);

  const snap = await db.collection('bookings').where('booking_status', '==', 'REQUESTED').get();
  const affected = [];

  for (const doc of snap.docs) {
    const b = doc.data();
    const rideSnap = await db.collection('rides').doc(String(b.ride_id)).get();
    const ride = rideSnap.exists ? rideSnap.data() : {};

    // Only rides that are over. A request on a live ride is still decidable by
    // the driver and must be left alone.
    if (!['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(String(ride.status))) continue;

    const paid = round2(Number(b.total_paid) || 0);
    if (paid <= 0) continue;

    const alreadyReturned = round2(Number(b.rider_refund) || 0);
    const owed = round2(paid - alreadyReturned);
    if (owed <= 0) continue;

    affected.push({
      id: doc.id,
      ref: doc.ref,
      rider: String(b.rider_id ?? ''),
      escrow: String(b.escrow_status),
      paid,
      alreadyReturned,
      owed,
      rideStatus: String(ride.status),
    });
  }

  if (affected.length === 0) {
    console.log('Nothing to remediate.');
    process.exit(0);
  }

  let total = 0;
  for (const a of affected) {
    total += a.owed;
    console.log(
      `  ${a.id.slice(0, 24)}  rider ${a.rider.slice(0, 8)}  ride ${a.rideStatus}  ` +
      `escrow ${a.escrow}  paid ₹${a.paid}  already back ₹${a.alreadyReturned}  OWED ₹${a.owed}`
    );
  }
  console.log(`\n${affected.length} booking(s), ₹${round2(total)} to return.\n`);

  if (!APPLY) {
    console.log('Dry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  let done = 0;
  for (const a of affected) {
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(a.ref);
        const f = fresh.data() || {};
        // Re-check under the transaction: a concurrent settle must not be
        // double-refunded on top of.
        const paidNow = round2(Number(f.total_paid) || 0);
        const backNow = round2(Number(f.rider_refund) || 0);
        const owedNow = round2(paidNow - backNow);
        if (owedNow <= 0) return;

        const walletRef = db.collection('wallets').doc(a.rider);
        const wallet = await tx.get(walletRef);
        const cur = wallet.exists
          ? wallet.data()
          : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };

        tx.set(walletRef, {
          ...cur,
          available_wallet_balance: round2((cur.available_wallet_balance || 0) + owedNow),
        }, { merge: true });

        tx.update(a.ref, {
          booking_status: 'DECLINED',
          escrow_status: 'CANCELLED',
          payment_status: 'CANCELLED_REFUNDED',
          cancelled_by: 'REMEDIATION_UNAPPROVED_AT_COMPLETION',
          rider_refund: paidNow,
          refunded_amount: paidNow,
          refund_destination: 'WALLET',
          remediated_at: new Date().toISOString(),
          remediation_note:
            'Ride ended while this seat request was still awaiting the driver. Refunded in full.',
        });
      });
      done++;
      console.log(`  refunded ${a.id.slice(0, 24)} — ₹${a.owed}`);
    } catch (err) {
      console.error(`  FAILED ${a.id.slice(0, 24)}: ${err.message}`);
    }
  }

  console.log(`\n${done}/${affected.length} remediated.`);
  process.exit(done === affected.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
