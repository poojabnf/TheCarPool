import { onSchedule } from 'firebase-functions/v2/scheduler';
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
export const instantiateRecurringRides = onSchedule(
  { schedule: 'every day 00:05', timeZone: 'Asia/Kolkata' },
  async () => {
    const now = new Date();
    const dow = now.getDay(); // 0 = Sunday
    const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');

    const snap = await db.collection('recurring_rides').get();
    let created = 0;

    // I03: Use a WriteBatch to avoid per-document round-trips.
    // Firestore batch limit is 500; flush every MAX_BATCH operations.
    const MAX_BATCH = 490;
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
      const t = doc.data();
      const days: number[] = Array.isArray(t.days_of_week) ? t.days_of_week : [];
      if (!days.includes(dow)) continue;

      // Build departure timestamp for today from "HH:MM".
      const [hh, mm] = String(t.departure_time_of_day || '08:00').split(':').map((n: string) => parseInt(n, 10));
      const departure = new Date(now);
      departure.setHours(hh || 8, mm || 0, 0, 0);

      const rideId = `ride_recurring_${doc.id}_${yyyymmdd}`;
      const rideRef = db.collection('rides').doc(rideId);

      // Idempotent create: skip if it already exists.
      const existing = await rideRef.get();
      if (existing.exists) continue;

      batch.set(rideRef, {
        id: rideId,
        driver_id: String(t.driver_id),
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
    }

    // Commit any remaining writes.
    if (batchCount > 0) {
      await batch.commit();
    }

    logger.info(`Recurring rides: created ${created} ride(s) for ${yyyymmdd} (dow=${dow}).`);
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
