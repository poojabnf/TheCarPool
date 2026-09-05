/**
 * Real-time narration of a live test.
 *
 * Reads Firestore directly with onSnapshot rather than scraping Cloud Run
 * access logs. Those logs lag 30-60s behind reality and carry only a URL and a
 * status code, so they can say "something was PATCHed" but never "Sanjay
 * accepted Shambhavi's seat" -- and a slow ingest reads identically to a
 * notification that never fired, which cost an hour of a previous session.
 * Firestore pushes the document itself the moment it changes: instant, and
 * self-explaining.
 *
 * Read-only. Listeners only, no writes.
 *
 *   node scripts/watch-live.mjs
 */
import admin from 'firebase-admin';
admin.initializeApp({ projectId: process.env.GCP_PROJECT || 'thecarpool-fe636' });
const db = admin.firestore();

const ist = (d = new Date()) =>
  new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(11, 19);
const say = (s) => console.log(`${ist()}  ${s}`);

// Names, cached, so every line reads as a person rather than a uid.
const nameCache = new Map();
async function who(uid) {
  if (!uid) return '(nobody)';
  if (nameCache.has(uid)) return nameCache.get(uid);
  let n = uid.slice(0, 8);
  try {
    const u = (await db.collection('users').doc(uid).get()).data();
    if (u) n = `${u.full_name || u.name || 'unnamed'}[${uid.slice(0, 6)}]`;
  } catch {}
  nameCache.set(uid, n);
  return n;
}

/**
 * Snapshot listeners fire once with everything that already exists; that
 * backlog is history, not events, so the whole first snapshot is swallowed.
 *
 * This was originally a timer, which was wrong: the opening snapshot carries
 * hundreds of documents and takes longer than any duration worth guessing, so
 * months of old rides printed as though they had just happened. The boundary
 * is the first callback -- Firestore delivers every pre-existing document in
 * exactly one snapshot.
 */
function listen(coll, handler) {
  const seen = new Map();
  let primed = false;
  db.collection(coll).onSnapshot(async (snap) => {
    const changes = snap.docChanges();
    for (const ch of changes) {
      const id = ch.doc.id;
      const data = ch.doc.data();
      const prev = seen.get(id);
      seen.set(id, data);
      if (!primed) continue;
      await handler(ch.type, id, data, prev);
    }
    if (!primed) {
      primed = true;
      say(`  ${coll}: ${changes.length} existing docs indexed, now live`);
    }
  }, (e) => say(`LISTENER ERROR on ${coll}: ${e.message}`));
}

listen('rides', async (type, id, r, prev) => {
  if (type === 'added') {
    say(`RIDE PUBLISHED  ${await who(r.driver_uid ?? r.driver_id)}  ₹${r.price_split}/seat  `
      + `${r.seats_available} seats  approval:${r.requires_approval}  ${id.slice(5, 13)}`);
  } else if (prev && prev.status !== r.status) {
    say(`RIDE ${prev.status} -> ${r.status}   ${await who(r.driver_uid ?? r.driver_id)}  ${id.slice(5, 13)}`);
  }
});

listen('bookings', async (type, id, b, prev) => {
  const rider = await who(b.rider_id);
  const tag = id.slice(8, 16);
  if (type === 'added') {
    say(`BOOKING CREATED  ${rider}  ₹${b.fare_amount}  ${b.payment_method}  `
      + `${b.booking_status}  escrow:${b.escrow_status}  OTP:${b.boarding_otp}  ${tag}`);
    return;
  }
  if (!prev) return;
  const diff = [];
  for (const k of ['booking_status', 'escrow_status', 'payment_status',
                   'boarding_verified', 'dropped_off_at', 'marked_no_show',
                   'cancelled_by', 'refund_destination', 'refunded_amount',
                   'settled_amount', 'cancellation_fee', 'settlement_due_at']) {
    if (String(prev[k]) !== String(b[k])) diff.push(`${k}: ${prev[k]} -> ${b[k]}`);
  }
  if (!diff.length) return;
  const headline =
      prev.boarding_verified !== true && b.boarding_verified === true ? 'BOARDING VERIFIED ✅'
    : !prev.dropped_off_at && b.dropped_off_at ? 'DROPPED OFF (15-min clock started)'
    : prev.booking_status !== b.booking_status ? `BOOKING ${b.booking_status}`
    : 'BOOKING UPDATED';
  say(`${headline}  ${rider}  ${tag}`);
  for (const d of diff) say(`      ${d}`);
});

listen('notifications', async (type, id, n) => {
  if (type !== 'added') return;
  say(`NOTIF -> ${await who(n.user_id || n.uid)}   ${n.type || ''}   `
    + `"${n.title || ''}" ${n.body ? '· ' + String(n.body).replace(/\s+/g, ' ').slice(0, 80) : ''}`);
});

listen('wallets', async (type, id, w, prev) => {
  if (type === 'added' || !prev) return;
  const a = Number(prev.available_wallet_balance || 0);
  const c = Number(w.available_wallet_balance || 0);
  if (a !== c) say(`WALLET  ${await who(id)}  ₹${a} -> ₹${c}  (${c > a ? '+' : ''}${(c - a).toFixed(2)})`);
});

// The SOS path, which until recently dispatched to nobody at all.
listen('sos_events', async (type, id, e) => {
  if (type !== 'added') return;
  say(`🚨 SOS  ${await who(e.user_id)}  ride:${e.ride_id ?? '-'}  `
    + `contacts_found:${e.contacts_found}  silent:${e.silent}`);
});

say('LIVE — Firestore listeners attached (rides, bookings, notifications, wallets, sos_events)');
say('priming: indexing existing docs -- every change after that prints instantly');
