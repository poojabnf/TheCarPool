#!/usr/bin/env node
/**
 * Prepare an App Store version for submission: attach the build, correct the
 * description, and set release notes.
 *
 * Deliberately does NOT submit. Submission is a separate, explicit act — this
 * app's version is set to releaseType AFTER_APPROVAL, meaning Apple releases it
 * to everyone the moment review passes, with no second confirmation.
 *
 * Usage:
 *   node scripts/asc-prepare.mjs            # show what it would change
 *   node scripts/asc-prepare.mjs --apply
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER = process.env.ASC_ISSUER_ID;
const KEY = readFileSync(process.env.ASC_KEY_PATH, 'utf8');
const APPLY = process.argv.includes('--apply');

// App Store version to act on. NO DEFAULT ON PURPOSE.
//
// This used to fall back to the id of version 1.4.6. A default that points at
// a specific past version does not degrade — it silently edits the wrong
// release, and you find out from the App Store rather than from this script.
// Failing here costs one command; the alternative costs a submission.
//
// Find the current id in App Store Connect, or from the API:
//   GET https://api.appstoreconnect.apple.com/v1/apps/<ASC_APP_ID>/appStoreVersions
// and take the id of the version whose versionString matches app.json.
const VERSION_ID = process.env.ASC_VERSION_ID;
if (!VERSION_ID) {
  console.error('ASC_VERSION_ID is required — set it to the App Store version you intend to change.');
  process.exit(1);
}
const LOC_ID = process.env.ASC_LOC_ID || '29481071-0897-4e2b-b31c-f3f1416693ee';         // en-US
const APP_ID = process.env.ASC_APP_ID || '6772426075';

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function tok() {
  const n = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: ISSUER, iat: n, exp: n + 900, aud: 'appstoreconnect-v1' }));
  const s = createSign('SHA256');
  s.update(`${h}.${p}`);
  return `${h}.${p}.${b64u(s.sign({ key: KEY, dsaEncoding: 'ieee-p1363' }))}`;
}
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('https://api.appstoreconnect.apple.com/v1' + path, {
    method,
    headers: { Authorization: 'Bearer ' + tok(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  const d = t ? (() => { try { return JSON.parse(t); } catch { return t; } })() : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${d?.errors?.map(e => e.detail).join('; ') || t}`);
  return d;
}

// ── Copy ───────────────────────────────────────────────────────────────────
// Corrected against what the app actually does now. The previous text
// advertised a "platform fee, GST" breakdown (the convenience fee is now zero)
// and "instant UPI payouts" (earnings reach a driver's account about two hours
// after the ride, or their wallet if they have no payout details). Store copy
// that overstates the product is both a review risk and a support burden.
const DESCRIPTION = `TheCarPool is carpooling for everyday journeys across India. Find people already heading your way, share the drive, and split the fuel cost fairly — so getting there is cheaper, greener, and a lot less lonely.

WHY THECARPOOL
• Know who you are travelling with — see each driver's name, rating, trip history and vehicle details before you book.
• Smart route matching — enter your pickup and destination and instantly see drivers already going your way, with the exact detour and fair per-seat price.
• No booking fees — you pay the seat fare and nothing else. There is no convenience fee, no surge and no haggling, and the driver receives the full fare.
• Escrow-protected payments — your fare is held safely via UPI/Razorpay and released to the driver only after they confirm you boarded with your 4-digit code.
• Optional journey insurance — add cover for a trip for ₹1 per 20 km. Entirely optional, and refunded in full if you cancel.

SAFETY FIRST
• One-tap SOS during a trip broadcasts your live location to your safety circle.
• Women-only rides filter for women travelling with women.
• Share your live trip with family and friends.
• Boarding codes — your driver confirms a 4-digit code before the trip starts.
• Real-time route monitoring with deviation alerts.

CLEAR, FAIR CANCELLATIONS
Free cancellation up to 2 hours before departure. After that a 10% charge applies, rising to 20% within the hour. You always see the exact amount before you confirm.

GREENER COMMUTES
Every shared ride takes a car off the road. Track the CO₂ you have avoided and the money you have saved, right in the app.

OFFER A RIDE
Driving in anyway? Offer your empty seats, set your route, price and pickup points, and earn back your fuel costs. Add your PAN and bank details to have earnings sent to your account, usually about a day after the ride; otherwise they go to your TheCarPool wallet and can be spent on your own rides.

MORE
• See the car make, model and colour before you book.
• Multiple pickup points so you do not have to walk to the driver's start.
• Wallet with UPI, net banking, card and wallet top-ups.
• Community classifieds for flatmates, buy/sell and sharing.
• Sign in fast with phone OTP, Google, or Apple.

TheCarPool — share the drive, split the fare.`;

const WHATS_NEW = `Cheaper, clearer and safer rides.

• No booking fees. You pay the seat fare and nothing else — the driver receives all of it.
• Boarding codes. Your driver confirms a 4-digit code before the trip starts, and is only paid once they do.
• See the car before you book — make, model and colour on every match.
• Multiple pickup points, so you can meet the driver somewhere convenient.
• Optional journey insurance from ₹1 per 20 km.
• Clearer cancellations — the exact charge is shown before you confirm.
• Faster driver payouts, straight to your bank or UPI.
• Fixed sign-in with Google, and a number of layout and stability fixes.`;

// ── Run ────────────────────────────────────────────────────────────────────
// The /apps/{id}/builds relationship endpoint rejects filter[version]; the
// top-level /builds collection accepts it alongside filter[app].
const build = await api(`/builds?filter[app]=${APP_ID}&filter[version]=150&limit=1`);
const buildId = build.data?.[0]?.id;
if (!buildId) throw new Error('Build 150 not found.');

console.log('version   :', VERSION_ID);
console.log('build 150 :', buildId);
console.log('description:', DESCRIPTION.length, 'chars (limit 4000)');
console.log('whatsNew  :', WHATS_NEW.length, 'chars (limit 4000)');

if (!APPLY) {
  console.log('\nDry run — pass --apply to write these to App Store Connect.');
  process.exit(0);
}

await api(`/appStoreVersions/${VERSION_ID}/relationships/build`, {
  method: 'PATCH',
  body: { data: { type: 'builds', id: buildId } },
});
console.log('✓ build 150 attached to the version');

await api(`/appStoreVersionLocalizations/${LOC_ID}`, {
  method: 'PATCH',
  body: {
    data: {
      type: 'appStoreVersionLocalizations',
      id: LOC_ID,
      attributes: { description: DESCRIPTION, whatsNew: WHATS_NEW },
    },
  },
});
console.log('✓ description and release notes updated');
console.log('\nNOT submitted. Review it in App Store Connect, then submit deliberately.');
