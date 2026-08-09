#!/usr/bin/env node
/**
 * End-to-end test of the money path against a real backend.
 *
 * WHY THIS EXISTS
 * The cancellation ladder and no-show split are unit-tested as pure functions,
 * but the Firestore transactions that actually move money around them are not.
 * This exercises those for real: booking, boarding-OTP verification, escrow
 * settlement, driver payout, cancellation tiers and the no-show split.
 *
 * NO REAL MONEY MOVES. Every booking here funds itself with `payment_method:
 * WALLET` against a seeded test-wallet balance, so Razorpay is never called and
 * your live keys are never exercised. That is the point: it validates the
 * arithmetic and the transactions without risking a rupee.
 *
 * WHAT IT TOUCHES
 * It creates real documents in whatever Firestore project your credentials
 * point at, prefixed `e2e_` and removed in the cleanup phase. Prefer running it
 * against staging. If you run it against production, it is additive and
 * self-cleaning, but it IS production.
 *
 * Usage:
 *   node scripts/e2e-money-path.mjs                 # against API_URL below
 *   API_URL=http://localhost:5000 node scripts/e2e-money-path.mjs
 *   node scripts/e2e-money-path.mjs --keep          # skip cleanup, inspect docs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const API_URL = process.env.API_URL
  || 'https://thecarpool-backend-953521578640.asia-south1.run.app';
const KEEP = process.argv.includes('--keep');

// Web API key, read at runtime from the mobile Firebase config so no key is
// hardcoded here.
function webApiKey() {
  if (process.env.FIREBASE_WEB_API_KEY) return process.env.FIREBASE_WEB_API_KEY;
  const g = JSON.parse(readFileSync(resolve(REPO, 'thecarpool-mobile/google-services.json'), 'utf8'));
  return g.client[0].api_key[0].current_key;
}

/**
 * Minting custom tokens requires an identity that can SIGN, which plain user
 * ADC (`gcloud auth application-default login`) cannot do. Three ways in, in
 * order of preference:
 *
 *   1. GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-adminsdk.json
 *      (Firebase console -> Project settings -> Service accounts -> Generate key)
 *   2. FIREBASE_SA_EMAIL=<sa>@<project>.iam.gserviceaccount.com, with your ADC
 *      principal holding roles/iam.serviceAccountTokenCreator on it
 *   3. Run it somewhere ADC *is* a service account (Cloud Shell, Cloud Run job)
 */
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'thecarpool-fe636';
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  admin.initializeApp({ projectId: PROJECT });
} else if (process.env.FIREBASE_SA_EMAIL) {
  admin.initializeApp({ projectId: PROJECT, serviceAccountId: process.env.FIREBASE_SA_EMAIL });
} else {
  admin.initializeApp({ projectId: PROJECT });
}
const db = admin.firestore();

const RIDER = 'e2e_rider_' + Date.now();
const DRIVER = 'e2e_driver_' + Date.now();
const created = { users: [], rides: [], bookings: [], wallets: [] };

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = Math.abs(Number(actual) - Number(expected)) < 0.01;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${actual}, expected ${expected}`);
  ok ? pass++ : fail++;
  return ok;
}
function note(msg) { console.log(`  ....  ${msg}`); }

// ── auth helpers ───────────────────────────────────────────────────────────
async function idTokenFor(uid) {
  let customToken;
  try {
    customToken = await admin.auth().createCustomToken(uid);
  } catch (err) {
    if (/service account|signBlob|Failed to determine/i.test(err.message)) {
      throw new Error(
        'Cannot mint custom tokens with the current credentials.\n' +
        '  Plain user ADC cannot sign. Use one of:\n' +
        '    GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-adminsdk.json node scripts/e2e-money-path.mjs\n' +
        '    FIREBASE_SA_EMAIL=<sa>@' + PROJECT + '.iam.gserviceaccount.com node scripts/e2e-money-path.mjs\n' +
        '  (get a key from Firebase console -> Project settings -> Service accounts)\n' +
        '  Original: ' + err.message
      );
    }
    throw err;
  }
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${webApiKey()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return data.idToken;
}

async function callApi(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

const walletOf = async (uid) =>
  Number((await db.collection('wallets').doc(uid).get()).data()?.available_wallet_balance || 0);

// ── fixtures ───────────────────────────────────────────────────────────────
async function seedUsers(balance) {
  for (const [uid, role] of [[RIDER, 'rider'], [DRIVER, 'partner']]) {
    await admin.auth().createUser({ uid, displayName: uid }).catch(() => {});
    await db.collection('users').doc(uid).set({
      name: uid, role, kyc_status: 'VERIFIED', gender: 'MALE',
    }, { merge: true });
    created.users.push(uid);
  }
  await db.collection('wallets').doc(RIDER).set({
    available_wallet_balance: balance, escrow_locked_balance: 0, currency: 'INR',
  });
  await db.collection('wallets').doc(DRIVER).set({
    available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR',
  });
  created.wallets.push(RIDER, DRIVER);
}

async function makeRide({ pricePerSeat, minutesFromNow, seats = 4 }) {
  const id = 'e2e_ride_' + Math.random().toString(36).slice(2, 10);
  await db.collection('rides').doc(id).set({
    id,
    driver_uid: DRIVER,
    driver_name: 'E2E Driver',
    status: 'SCHEDULED',
    seats_total: seats,
    seats_available: seats,
    price_split: pricePerSeat,
    distance_km: 12,
    departure_time: new Date(Date.now() + minutesFromNow * 60000).toISOString(),
    women_only: false,
  });
  created.rides.push(id);
  return id;
}

async function book(riderToken, rideId, seats = 1) {
  const r = await callApi(riderToken, '/api/bookings', {
    method: 'POST',
    body: {
      ride_id: rideId, rider_id: RIDER, seats_booked: seats,
      payment_method: 'WALLET',
      pickup_lat: 28.42, pickup_lng: 77.08, drop_lat: 28.50, drop_lng: 77.10,
    },
  });
  if (r.ok) created.bookings.push(r.data.id);
  return r;
}

// ── scenarios ──────────────────────────────────────────────────────────────
async function scenarioHappyPath(riderToken, driverToken) {
  console.log('\n[1] Happy path — verified boarding, driver paid 100% of fare');
  const fare = 200;
  const rideId = await makeRide({ pricePerSeat: fare, minutesFromNow: 600 });
  const riderBefore = await walletOf(RIDER);
  const driverBefore = await walletOf(DRIVER);

  const b = await book(riderToken, rideId);
  if (!b.ok) { console.log('  FAIL  booking rejected:', b.status, JSON.stringify(b.data)); fail++; return; }
  check('rider debited by fare', riderBefore - (await walletOf(RIDER)), fare);

  const mine = await callApi(riderToken, '/api/bookings/mine');
  const otp = mine.data.bookings.find((x) => x.id === b.data.id)?.boarding_otp;
  note(`boarding OTP issued to rider: ${otp}`);

  const bad = await callApi(driverToken, `/api/bookings/${b.data.id}/verify-boarding-otp`, {
    method: 'POST', body: { otp: otp === '0000' ? '1111' : '0000' },
  });
  check('wrong OTP rejected (400)', bad.status, 400);

  const ok = await callApi(driverToken, `/api/bookings/${b.data.id}/verify-boarding-otp`, {
    method: 'POST', body: { otp },
  });
  check('correct OTP accepted (200)', ok.status, 200);

  await callApi(driverToken, `/api/rides/${rideId}/status`, { method: 'PATCH', body: { status: 'STARTED' } });
  const done = await callApi(driverToken, `/api/rides/${rideId}/status`, { method: 'PATCH', body: { status: 'COMPLETED' } });
  check('completion succeeded', done.status, 200);
  check('DRIVER CREDITED full fare', (await walletOf(DRIVER)) - driverBefore, fare);
}

async function scenarioNoShow(riderToken, driverToken) {
  console.log('\n[2] No-show — OTP never verified, 80/5/15 split');
  const fare = 200;
  const rideId = await makeRide({ pricePerSeat: fare, minutesFromNow: 600 });
  const riderBefore = await walletOf(RIDER);
  const driverBefore = await walletOf(DRIVER);

  const b = await book(riderToken, rideId);
  if (!b.ok) { console.log('  FAIL  booking rejected:', JSON.stringify(b.data)); fail++; return; }

  await callApi(driverToken, `/api/rides/${rideId}/status`, { method: 'PATCH', body: { status: 'STARTED' } });
  await callApi(driverToken, `/api/rides/${rideId}/status`, { method: 'PATCH', body: { status: 'COMPLETED' } });

  check('driver got 5% only', (await walletOf(DRIVER)) - driverBefore, fare * 0.05);
  check('rider refunded 80% net of the debit', (await walletOf(RIDER)) - riderBefore, -fare + fare * 0.8);
}

async function scenarioCancellations(riderToken) {
  console.log('\n[3] Cancellation ladder — quote must equal what is charged');
  for (const [label, mins, feePct] of [
    ['free (>2h)', 600, 0],
    ['standard (1-2h)', 90, 10],
    ['late (<1h)', 30, 20],
    ['imminent (<15m)', 5, 20],
  ]) {
    const fare = 200;
    const rideId = await makeRide({ pricePerSeat: fare, minutesFromNow: mins });
    const b = await book(riderToken, rideId);
    if (!b.ok) { console.log(`  FAIL  ${label}: booking rejected`, JSON.stringify(b.data)); fail++; continue; }

    const q = await callApi(riderToken, `/api/bookings/${b.data.id}/cancellation-quote`);
    const before = await walletOf(RIDER);
    const c = await callApi(riderToken, `/api/bookings/${b.data.id}/cancel`, { method: 'PATCH' });

    check(`${label} quoted fee`, q.data.cancellation_fee, (fare * feePct) / 100);
    check(`${label} charged == quoted`, c.data.cancellation_fee, q.data.cancellation_fee);
    check(`${label} refund to wallet`, (await walletOf(RIDER)) - before, fare - (fare * feePct) / 100);
  }
}

async function scenarioUnpaidRejected(riderToken) {
  console.log('\n[4] Payment enforcement — a seat cannot be booked without funds');
  const rideId = await makeRide({ pricePerSeat: 5000, minutesFromNow: 600 });
  const r = await book(riderToken, rideId);
  check('insufficient wallet rejected (402)', r.status, 402);
  const ride = (await db.collection('rides').doc(rideId).get()).data();
  check('seat NOT consumed on rejection', ride.seats_available, 4);
}

async function cleanup() {
  if (KEEP) { console.log('\n--keep: leaving test documents in place.'); return; }
  console.log('\nCleaning up…');
  for (const id of created.bookings) await db.collection('bookings').doc(id).delete().catch(() => {});
  for (const id of created.rides) await db.collection('rides').doc(id).delete().catch(() => {});
  for (const id of created.wallets) await db.collection('wallets').doc(id).delete().catch(() => {});
  for (const id of created.users) {
    await db.collection('users').doc(id).delete().catch(() => {});
    await admin.auth().deleteUser(id).catch(() => {});
  }
  const snap = await db.collection('referral_redemptions').where('user_id', '==', RIDER).get().catch(() => ({ docs: [] }));
  for (const d of snap.docs) await d.ref.delete().catch(() => {});
  console.log('done.');
}

// ── main ───────────────────────────────────────────────────────────────────
console.log(`Money-path E2E against ${API_URL}`);
console.log(`rider=${RIDER}\ndriver=${DRIVER}`);
console.log('No Razorpay call is made; every booking is wallet-funded.\n');

try {
  await seedUsers(20000);
  const riderToken = await idTokenFor(RIDER);
  const driverToken = await idTokenFor(DRIVER);

  await scenarioHappyPath(riderToken, driverToken);
  await scenarioNoShow(riderToken, driverToken);
  await scenarioCancellations(riderToken);
  await scenarioUnpaidRejected(riderToken);
} catch (err) {
  console.error('\nERROR:', err.message);
  fail++;
} finally {
  await cleanup().catch((e) => console.error('cleanup failed:', e.message));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
