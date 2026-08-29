/**
 * End-to-end check for per-stop fares, against the DEPLOYED backend.
 *
 * The thing being verified is not that the maths is right — unit tests cover
 * that — but that the quote a rider is shown and the fare the booking endpoint
 * would charge are resolved from the same place once the code is actually
 * running in Cloud Run. That is exactly what broke: the mobile UI shipped over
 * the air while the server had no code to honour it, so a driver's ₹200 stop
 * fare was silently dropped and the rider was charged the full journey price.
 *
 * Creates a ride, quotes against it, and deletes it again. Pass --keep to
 * leave the ride behind for inspection.
 *
 * Usage (needs an identity that can SIGN custom tokens — plain user ADC
 * cannot, see e2e-money-path.mjs for the alternatives):
 *
 *   FIREBASE_SA_EMAIL=953521578640-compute@developer.gserviceaccount.com \
 *     node scripts/e2e-stop-pricing.mjs
 */
import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROJECT = process.env.GCP_PROJECT || 'thecarpool-fe636';
const API_URL = process.env.API_URL
  || 'https://thecarpool-backend-953521578640.asia-south1.run.app';
const KEEP = process.argv.includes('--keep');

function webApiKey() {
  if (process.env.FIREBASE_WEB_API_KEY) return process.env.FIREBASE_WEB_API_KEY;
  const g = JSON.parse(readFileSync(resolve(REPO, 'thecarpool-mobile/google-services.json'), 'utf8'));
  return g.client[0].api_key[0].current_key;
}

if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  admin.initializeApp({ projectId: PROJECT });
} else if (process.env.FIREBASE_SA_EMAIL) {
  admin.initializeApp({ projectId: PROJECT, serviceAccountId: process.env.FIREBASE_SA_EMAIL });
} else {
  admin.initializeApp({ projectId: PROJECT });
}
const db = admin.firestore();

async function idTokenFor(uid) {
  const customToken = await admin.auth().createCustomToken(uid);
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

// Delhi → Mumbai, picking up at Surat. Real coordinates so the service-area
// and metro checks behave as they would for a genuine ride.
const DELHI = { lat: 28.6139, lng: 77.2090 };
const MUMBAI = { lat: 19.0760, lng: 72.8777 };
const SURAT = { lat: 21.1702, lng: 72.8311 };
const FULL_FARE = 500;
const SURAT_FARE = 200;

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const driverUid = `e2e_stopprice_driver_${Date.now()}`;
const riderUid = `e2e_stopprice_rider_${Date.now()}`;
let rideId = null;

try {
  console.log(`Stop-pricing E2E against ${API_URL}\n`);

  await db.collection('users').doc(driverUid).set({
    id: driverUid, full_name: 'E2E Driver', email: `${driverUid}@example.test`, gender: 'MALE',
  });
  await db.collection('users').doc(riderUid).set({
    id: riderUid, full_name: 'E2E Rider', email: `${riderUid}@example.test`, gender: 'MALE',
  });

  const driverToken = await idTokenFor(driverUid);
  const riderToken = await idTokenFor(riderUid);

  // ── Post a ride with one priced stop ────────────────────────────────────
  const departure = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const created = await callApi(driverToken, '/api/rides', {
    method: 'POST',
    body: {
      driver_id: driverUid,
      source: 'Connaught Place, New Delhi, Delhi',
      destination: 'Bandra Kurla Complex, Mumbai, Maharashtra',
      route_geojson: {
        type: 'LineString',
        coordinates: [[DELHI.lng, DELHI.lat], [SURAT.lng, SURAT.lat], [MUMBAI.lng, MUMBAI.lat]],
      },
      seats_total: 3,
      price_split: FULL_FARE,
      departure_time: departure,
      vehicle_type: 'CAR',
      distance_km: 1400,
      pickup_points: [
        { label: 'Surat', lat: SURAT.lat, lng: SURAT.lng, price: SURAT_FARE },
      ],
    },
  });

  check('ride created', created.ok, `status ${created.status} ${JSON.stringify(created.data).slice(0, 200)}`);
  if (!created.ok) throw new Error('cannot continue without a ride');
  rideId = created.data.id;

  const storedStop = (created.data.pickup_points || [])[0];
  check('stop price survived the round trip to Firestore',
    storedStop && storedStop.price === SURAT_FARE,
    `got ${JSON.stringify(storedStop)}`);

  // ── Quote from the origin: full fare ────────────────────────────────────
  const qFull = await callApi(riderToken,
    `/api/bookings/quote?ride_id=${rideId}&seats=1&pickup_lat=${DELHI.lat}&pickup_lng=${DELHI.lng}`);
  check('quote from origin is the full fare',
    qFull.ok && qFull.data.fare_amount === FULL_FARE,
    `got ${JSON.stringify(qFull.data?.fare_amount)}`);
  check('origin quote is not flagged as a stop fare',
    qFull.ok && !qFull.data.fare_via_stop,
    `got ${JSON.stringify(qFull.data?.fare_via_stop)}`);

  // ── Quote from the priced stop: the stop's fare ─────────────────────────
  const qStop = await callApi(riderToken,
    `/api/bookings/quote?ride_id=${rideId}&seats=1&pickup_lat=${SURAT.lat}&pickup_lng=${SURAT.lng}`);
  check('quote from the stop charges the stop fare',
    qStop.ok && qStop.data.fare_amount === SURAT_FARE,
    `got ${JSON.stringify(qStop.data?.fare_amount)} (expected ${SURAT_FARE})`);
  check('stop quote names the stop, so the app can explain the lower price',
    qStop.ok && qStop.data.fare_via_stop === 'Surat',
    `got ${JSON.stringify(qStop.data?.fare_via_stop)}`);
  check('stop quote still reports the full-journey fare for comparison',
    qStop.ok && qStop.data.full_journey_fare_per_seat === FULL_FARE,
    `got ${JSON.stringify(qStop.data?.full_journey_fare_per_seat)}`);

  // ── Two seats from the stop: the stop fare, doubled ─────────────────────
  const qTwo = await callApi(riderToken,
    `/api/bookings/quote?ride_id=${rideId}&seats=2&pickup_lat=${SURAT.lat}&pickup_lng=${SURAT.lng}`);
  check('stop fare multiplies by seats',
    qTwo.ok && qTwo.data.fare_amount === SURAT_FARE * 2,
    `got ${JSON.stringify(qTwo.data?.fare_amount)}`);

  // ── A stop the driver left BLANK is priced by distance ──────────────────
  // The reported case: ₹1000 over 1000 km, a 400 km leg should cost ~₹400.
  // This failed in production while the unit tests were green, because the
  // route a real ride posts has only two points and the old code snapped
  // intermediate stops to an endpoint.
  // Real Indian coordinates: Delhi due south ~1000 km into Maharashtra. A
  // meridian keeps the arithmetic clean (1 degree of latitude ~ 111.32 km)
  // while staying inside the service area — synthetic points near (0, 78) sit
  // in the Indian Ocean and are correctly refused.
  const DEG_PER_KM = 1 / 111.32;
  const LNG = 77.2090;
  const destM = { lat: 19.6300, lng: LNG };                          // Maharashtra
  const originM = { lat: destM.lat + 1000 * DEG_PER_KM, lng: LNG };  // ~Delhi
  const stop400 = { lat: destM.lat + 400 * DEG_PER_KM, lng: LNG };   // ~Madhya Pradesh

  const blankRide = await callApi(driverToken, '/api/rides', {
    method: 'POST',
    body: {
      driver_id: driverUid,
      source: 'New Delhi, Delhi',
      destination: 'Nashik, Maharashtra',
      route_geojson: {
        type: 'LineString',
        coordinates: [[originM.lng, originM.lat], [destM.lng, destM.lat]],
      },
      seats_total: 3,
      price_split: 1000,
      departure_time: departure,
      vehicle_type: 'CAR',
      distance_km: 1000,
      // Deliberately no price on the stop.
      pickup_points: [{ label: 'Midway', lat: stop400.lat, lng: stop400.lng }],
    },
  });
  check('ride with an unpriced stop created', blankRide.ok,
    `status ${blankRide.status} ${JSON.stringify(blankRide.data).slice(0, 160)}`);

  if (blankRide.ok) {
    const blankId = blankRide.data.id;
    const qBlank = await callApi(riderToken,
      `/api/bookings/quote?ride_id=${blankId}&seats=1&pickup_lat=${stop400.lat}&pickup_lng=${stop400.lng}`);
    const got = qBlank.data?.fare_amount;
    check('a 400 km leg left blank costs about ₹400, not the full ₹1000',
      qBlank.ok && got > 380 && got < 420,
      `got ${JSON.stringify(got)}`);
    check('the app is told the fare was estimated, not chosen by the driver',
      qBlank.ok && qBlank.data.fare_estimated === true,
      `got ${JSON.stringify(qBlank.data?.fare_estimated)}`);
    await db.collection('rides').doc(blankId).delete().catch(() => {});
  }

  // ── A stop dearer than the journey is refused at creation ───────────────
  const bad = await callApi(driverToken, '/api/rides', {
    method: 'POST',
    body: {
      driver_id: driverUid,
      source: 'Connaught Place, New Delhi, Delhi',
      destination: 'Bandra Kurla Complex, Mumbai, Maharashtra',
      route_geojson: {
        type: 'LineString',
        coordinates: [[DELHI.lng, DELHI.lat], [MUMBAI.lng, MUMBAI.lat]],
      },
      seats_total: 2,
      price_split: 100,
      departure_time: departure,
      vehicle_type: 'CAR',
      pickup_points: [{ label: 'Surat', lat: SURAT.lat, lng: SURAT.lng, price: 900 }],
    },
  });
  check('a stop dearer than the whole journey is rejected',
    bad.status === 400 && bad.data?.error === 'INVALID_STOP_FARE',
    `status ${bad.status} ${JSON.stringify(bad.data).slice(0, 160)}`);
  if (bad.ok && bad.data?.id) await db.collection('rides').doc(bad.data.id).delete();

} catch (err) {
  failed++;
  console.error('\nERROR:', err.message);
} finally {
  if (rideId && !KEEP) {
    await db.collection('rides').doc(rideId).delete().catch(() => {});
    console.log(`\ncleaned up ride ${rideId}`);
  }
  await db.collection('users').doc(driverUid).delete().catch(() => {});
  await db.collection('users').doc(riderUid).delete().catch(() => {});
  await admin.auth().deleteUser(driverUid).catch(() => {});
  await admin.auth().deleteUser(riderUid).catch(() => {});

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
