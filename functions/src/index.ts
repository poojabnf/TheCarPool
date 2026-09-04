import { onSchedule } from 'firebase-functions/v2/scheduler';
import { auth } from 'firebase-functions/v1';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

/**
 * Recurring ride instantiation.
 *
 * Runs every day just after midnight (Asia/Kolkata) and materialises a
 * concrete `rides` document for each `recurring_rides` template whose
 * `days_of_week` includes today. Doc ids are deterministic
 * (`ride_recurring_<templateId>_<YYYYMMDD>`) so re-runs are idempotent and
 * never create duplicates.
 *
 * Template shape (see backend POST /api/rides/recurring):
 *   { id, driver_id, route_coords, seats_total, price_split,
 *     departure_time_of_day: "HH:MM", days_of_week: number[] (0=Sun), vehicle_type }
 */
/**
 * India Standard Time, computed rather than assumed.
 *
 * onSchedule's `timeZone` decides WHEN a function fires, not what timezone the
 * process runs in -- that is UTC. So a job scheduled for 00:05 Asia/Kolkata
 * woke up while UTC still said 18:35 the previous day, and every date-derived
 * value was a day behind: getDay() returned yesterday's weekday, so templates
 * for a given day never fired and the previous day's fired twice; the ride id
 * carried yesterday's date; and setHours(8, 0) wrote 08:00 UTC, which is 13:30
 * in Delhi. Recurring rides were generated for the wrong day, at the wrong
 * time, under an id that collided with the day before.
 *
 * IST is UTC+05:30 with no daylight saving, so shifting the instant and then
 * reading its UTC fields gives the local wall clock exactly.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

interface IstNow {
  /** 0 = Sunday, in India. */
  dow: number;
  /** YYYYMMDD as written in India. */
  yyyymmdd: string;
  year: number; month: number; day: number;
}

function istParts(now: Date): IstNow {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    dow: shifted.getUTCDay(),
    yyyymmdd: shifted.toISOString().slice(0, 10).replace(/-/g, ''),
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

/** The instant at which a given IST wall-clock time occurs today. */
function istWallClockToInstant(p: IstNow, hh: number, mm: number): Date {
  return new Date(Date.UTC(p.year, p.month, p.day, hh, mm, 0, 0) - IST_OFFSET_MS);
}

export const instantiateRecurringRides = onSchedule(
  { schedule: 'every day 00:05', timeZone: 'Asia/Kolkata' },
  async () => {
    const now = new Date();
    // Read in India, where the riders and the schedule both are.
    const ist = istParts(now);
    const dow = ist.dow; // 0 = Sunday, IST
    const yyyymmdd = ist.yyyymmdd;

    const snap = await db.collection('recurring_rides').get();
    let created = 0;

    // I03: Use a WriteBatch to avoid per-document round-trips.
    // Firestore batch limit is 500; flush every MAX_BATCH operations.
    const MAX_BATCH = 490;
    let batch = db.batch();
    let batchCount = 0;

    let skipped = 0;

    for (const doc of snap.docs) {
      // Isolated per document: one malformed template used to abort the whole
      // run, so every later recurring ride silently failed to be created that
      // day. Log the offending id and carry on.
      try {
      const t = doc.data();
      const days: number[] = Array.isArray(t.days_of_week) ? t.days_of_week : [];
      if (!days.includes(dow)) continue;

      // Build departure timestamp for today from "HH:MM".
      // "08:00" means eight in the morning in Delhi, not 08:00 UTC.
      const [hh, mm] = String(t.departure_time_of_day || '08:00').split(':').map((n: string) => parseInt(n, 10));
      const departure = istWallClockToInstant(ist, Number.isFinite(hh) ? hh : 8, Number.isFinite(mm) ? mm : 0);

      const rideId = `ride_recurring_${doc.id}_${yyyymmdd}`;
      const rideRef = db.collection('rides').doc(rideId);

      // Idempotent create: skip if it already exists.
      const existing = await rideRef.get();
      if (existing.exists) continue;

      batch.set(rideRef, {
        id: rideId,
        driver_id: String(t.driver_id),
        driver_uid: String(t.driver_uid || (String(t.driver_id).startsWith('driver_') ? String(t.driver_id).replace('driver_', '') : t.driver_id)),
        route_coords: t.route_coords || [],
        seats_total: Number(t.seats_total) || 0,
        seats_available: Number(t.seats_total) || 0,
        price_split: Number(t.price_split) || 0,
        departure_time: departure.toISOString(),
        vehicle_type: t.vehicle_type || 'CAR',
        status: 'SCHEDULED',
        source_recurring_id: doc.id,
        created_at: new Date().toISOString(),
      });
      batchCount++;
      created++;

      if (batchCount >= MAX_BATCH) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
      } catch (err) {
        skipped++;
        logger.error(`Recurring ride template ${doc.id} skipped`, err);
      }
    }

    // Commit any remaining writes.
    if (batchCount > 0) {
      await batch.commit();
    }

    logger.info(
      `Recurring rides: created ${created} ride(s) for ${yyyymmdd} (dow=${dow})` +
      (skipped > 0 ? `, skipped ${skipped} malformed template(s).` : '.')
    );
  },
);

/**
 * Auto-expire stale rides.
 *
 * Runs every hour. Marks any SCHEDULED ride whose departure_time was more
 * than 2 hours ago as EXPIRED so it no longer appears in search results or
 * accepts new bookings.
 */
export const autoExpireStaleRides = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'Asia/Kolkata' },
  async () => {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const snap = await db.collection('rides')
      .where('status', '==', 'SCHEDULED')
      .where('departure_time', '<', cutoff)
      .limit(200)
      .get();

    if (snap.empty) {
      logger.info('autoExpireStaleRides: nothing to expire.');
      return;
    }

    const MAX_BATCH = 490;
    let batch = db.batch();
    let count = 0;

    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        status: 'EXPIRED',
        expired_at: new Date().toISOString(),
      });
      count++;
      if (count % MAX_BATCH === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    if (count % MAX_BATCH !== 0) await batch.commit();

    logger.info(`autoExpireStaleRides: expired ${count} stale ride(s).`);
  },
);

/**
 * Reset corporate monthly budgets.
 *
 * Runs at 00:10 on the 1st of every month (IST). Resets spent_this_month to 0
 * on all corporate_accounts documents so the monthly billing cap applies fresh.
 * Without this, once the budget is hit it stays blocked forever.
 */
export const resetCorporateBudgets = onSchedule(
  { schedule: '10 0 1 * *', timeZone: 'Asia/Kolkata' },
  async () => {
    const snap = await db.collection('corporate_accounts').get();
    if (snap.empty) {
      logger.info('resetCorporateBudgets: no accounts found.');
      return;
    }

    const MAX_BATCH = 490;
    let batch = db.batch();
    let count = 0;

    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        spent_this_month: 0,
        budget_reset_at: new Date().toISOString(),
      });
      count++;
      if (count % MAX_BATCH === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    if (count % MAX_BATCH !== 0) await batch.commit();

    logger.info(`resetCorporateBudgets: reset ${count} corporate account(s).`);
  },
);

/**
 * Clean up Firestore data when a user account is deleted from Firebase Auth.
 */
/**
 * Tidy up after a deleted Firebase Auth user -- without destroying evidence.
 *
 * This used to hard-delete the user document, their wallet, every ride they
 * had driven, every booking they had made and their classifieds. Three things
 * were wrong with that.
 *
 * A ride and a booking are not the user's records; they are shared. Deleting
 * them takes the counterparty's history with them -- a driver loses the
 * passenger manifest for a trip that happened, and a rider loses the receipt
 * for a journey they paid for.
 *
 * Money vanished with it. A wallet with a balance, or a booking with escrow
 * still HELD, was deleted outright: no refund, no record, funds orphaned at
 * the payment provider with nothing left to reconcile against.
 *
 * And it fought the backend. DELETE /api/safety/account refuses to proceed
 * while escrow is held or a ride has passengers, settles the balance, then
 * anonymises. This function ran afterwards and deleted what that flow had
 * deliberately kept -- and when an auth user is removed from the Firebase
 * console instead, it bypassed those guards entirely.
 *
 * So it anonymises, and it never touches money. The backend's flow remains
 * the way an account is closed properly; this is the safety net beneath it.
 */
export const onUserDeleted = auth.user().onDelete(async (user) => {
  const uid = user.uid;
  if (!uid) {
    logger.warn('onUserDeleted: No uid found.');
    return;
  }
  logger.info(`onUserDeleted: anonymising records for ${uid}`);

  try {
    const now = new Date().toISOString();

    // Loud, because it means the account was removed by a route that skipped
    // the backend's guards -- most likely straight from the Firebase console
    // -- and somebody is owed money that nothing will now chase.
    const [walletSnap, heldSnap] = await Promise.all([
      db.collection('wallets').doc(uid).get(),
      db.collection('bookings')
        .where('rider_id', '==', uid)
        .where('escrow_status', '==', 'HELD')
        .get(),
    ]);
    const balance = Number(walletSnap.data()?.available_wallet_balance || 0);
    if (balance > 0 || !heldSnap.empty) {
      logger.error(
        `onUserDeleted: ${uid} deleted with money outstanding — ` +
        `wallet ${balance}, ${heldSnap.size} booking(s) still in escrow. ` +
        'Records kept for reconciliation; settle manually.'
      );
    }

    // The user document is the only thing genuinely theirs alone. Identifying
    // fields go; the row stays so the rides and bookings pointing at it still
    // resolve to something rather than dangling.
    await db.collection('users').doc(uid).set({
      deleted: true,
      deleted_at: now,
      name: 'Deleted user',
      full_name: 'Deleted user',
      phone_number: null,
      phone: null,
      email: null,
      corporate_email: null,
      photo_url: null,
      avatar_path: null,
      pan_number: null,
      pan_name: null,
      fcm_tokens: [],
      expo_push_tokens: [],
    }, { merge: true });

    // Identity indexes must go, or the number and email stay claimed and the
    // person cannot sign up again.
    const idx = await Promise.all([
      db.collection('phone_identities').where('uid', '==', uid).get(),
      db.collection('email_identities').where('uid', '==', uid).get(),
    ]);
    const batch = db.batch();
    for (const snap of idx) for (const d of snap.docs) batch.delete(d.ref);

    // Classifieds are the user's own postings with no counterparty, so these
    // do go.
    const classifieds = await db.collection('classifieds').where('author_id', '==', uid).get();
    for (const d of classifieds.docs) batch.delete(d.ref);
    await batch.commit();

    logger.info(
      `onUserDeleted: ${uid} anonymised; ` +
      `${classifieds.size} classified(s) removed, rides and bookings retained.`
    );
  } catch (err: any) {
    logger.error(`onUserDeleted: Failed to anonymise data for user ${uid}`, err);
  }
});
