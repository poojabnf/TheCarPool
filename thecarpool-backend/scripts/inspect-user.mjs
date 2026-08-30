/**
 * Everything about one user, on one screen.
 *
 * "Something is wrong for this rider" used to mean six manual lookups across
 * two systems: the Firebase Auth record, the Firestore user document, the
 * phone index, their bookings, their wallet, their push tokens. Each in a
 * different console, none of them cross-referenced, and the interesting answer
 * is almost always in the gaps BETWEEN them — a number in Auth that never
 * reached Firestore, a push token that is registered and dead, a booking whose
 * notification was written but never delivered.
 *
 * Read-only. It writes nothing and sends nothing: the FCM check is a dry run,
 * which asks Google whether a token would be accepted without delivering
 * anything to the device.
 *
 *   node scripts/inspect-user.mjs +919876543210
 *   node scripts/inspect-user.mjs someone@example.com
 *   node scripts/inspect-user.mjs 7rADUap3rOO7JHjCqMBclncBIDt2
 *
 * Accepts a phone in any shape a human writes it, an email, or a uid.
 */
import admin from 'firebase-admin';

const PROJECT = process.env.GCP_PROJECT || 'thecarpool-fe636';
const query = process.argv[2];

if (!query) {
  console.error('Usage: node scripts/inspect-user.mjs <phone|email|uid>');
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

/** Mirrors lib/identity.normalisePhone — the same rules the app keys on. */
function normalisePhone(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

const h = (t) => console.log(`\n${'─'.repeat(64)}\n${t}\n${'─'.repeat(64)}`);
const row = (k, v) => console.log(`  ${String(k).padEnd(22)} ${v ?? '—'}`);
const ago = (iso) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
};

// ── Resolve the input to an Auth record ────────────────────────────────────
let authUser = null;
const phone = normalisePhone(query);

try {
  if (phone) authUser = await admin.auth().getUserByPhoneNumber(phone);
  else if (query.includes('@')) authUser = await admin.auth().getUserByEmail(query);
  else authUser = await admin.auth().getUser(query);
} catch {
  // Not in Auth under that key. A Firestore doc may still exist — a user can
  // have been deleted from Auth, or hold a number only Firestore knows about.
}

let uid = authUser?.uid ?? null;

if (!uid) {
  const field = phone ? 'phone' : query.includes('@') ? 'email' : null;
  if (field) {
    const snap = await db.collection('users').where(field, '==', phone ?? query).limit(1).get();
    if (!snap.empty) uid = snap.docs[0].id;
  } else {
    const doc = await db.collection('users').doc(query).get();
    if (doc.exists) uid = query;
  }
}

if (!uid) {
  console.log(`\nNo user found for "${query}" in Firebase Auth or Firestore.`);
  process.exit(0);
}

// ── Identity ───────────────────────────────────────────────────────────────
h('IDENTITY');
row('uid', uid);
if (authUser) {
  row('auth phone', authUser.phoneNumber);
  row('auth email', authUser.email);
  row('auth name', authUser.displayName);
  row('providers', authUser.providerData.map((p) => p.providerId).join(', ') || 'none');
  row('created', authUser.metadata.creationTime);
  row('last sign-in', authUser.metadata.lastSignInTime);
  row('disabled', authUser.disabled ? 'YES' : 'no');
} else {
  row('auth record', 'MISSING — Firestore doc exists but no Auth user');
}

const userDoc = await db.collection('users').doc(uid).get();
const u = userDoc.exists ? userDoc.data() : null;
if (!u) {
  row('firestore doc', 'MISSING — user has never completed /users/me');
} else {
  row('firestore phone', u.phone);
  row('firestore email', u.email || u.corporate_email);
  row('name', u.name || u.displayName || u.full_name);
  row('onboarded', u.onboarded ? 'yes' : 'no');
  row('role', u.role);
}

// The gap that silently splits one person into two accounts.
const authPhone = authUser?.phoneNumber ? normalisePhone(authUser.phoneNumber) : null;
const idxKey = (u?.phone && normalisePhone(u.phone)) || authPhone;
let idx = null;
if (idxKey) {
  const d = await db.collection('phone_identities').doc(idxKey.replace(/^\+/, '')).get();
  idx = d.exists ? d.data() : null;
}
row('phone index', idx ? `→ ${idx.uid}${idx.uid === uid ? ' (this user)' : ' (DIFFERENT UID)'}` : 'NOT INDEXED');

const problems = [];
if (authPhone && !u?.phone) {
  problems.push('Verified phone in Auth never copied to Firestore: no SMS, no call button, and signing in with Google elsewhere will create a SECOND account.');
}
if (idxKey && !idx) {
  problems.push('Not in phone_identities: a second sign-in provider will not be linked to this profile.');
}
if (idx && idx.uid !== uid) {
  problems.push(`Phone index points at ${idx.uid}, not this uid — this is the duplicate half of a split identity.`);
}

// ── Push delivery ──────────────────────────────────────────────────────────
h('PUSH TOKENS  (dry run — nothing is delivered)');
const tokens = Object.entries(u?.push_tokens ?? {});
if (tokens.length === 0) {
  console.log('  none registered — this user cannot receive push at all');
  problems.push('No push tokens: every notification reaches the in-app inbox only.');
} else {
  let alive = 0;
  for (const [tok, meta] of tokens) {
    try {
      await admin.messaging().send({ token: tok, notification: { title: 't', body: 'b' } }, true);
      console.log(`  ALIVE  ${String(meta?.platform ?? '?').padEnd(8)} ${tok.slice(0, 24)}…`);
      alive++;
    } catch (e) {
      console.log(`  DEAD   ${String(meta?.platform ?? '?').padEnd(8)} ${tok.slice(0, 24)}…  ${e.errorInfo?.code ?? e.code}`);
    }
  }
  if (alive === 0) problems.push('Every registered token is dead — push cannot reach this user.');
}

// ── Notifications actually recorded ────────────────────────────────────────
h('NOTIFICATIONS  (last 10)');
const notifs = await db.collection('notifications')
  .where('user_id', '==', uid).limit(50).get();
const sorted = notifs.docs
  .map((d) => d.data())
  .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  .slice(0, 10);
if (sorted.length === 0) console.log('  none');
for (const n of sorted) {
  console.log(`  ${String(n.created_at).slice(0, 19)}  ${String(n.type ?? '-').padEnd(26)} ${n.read ? '' : '● '}${String(n.title ?? '').slice(0, 30)}`);
}

// ── Money and bookings ─────────────────────────────────────────────────────
h('WALLET & PAYOUT');
const w = (await db.collection('wallets').doc(uid).get()).data();
row('available', w?.available_wallet_balance ?? u?.wallet_balance ?? 0);
row('escrow locked', w?.escrow_locked_balance ?? 0);
row('payout method', u?.payout_method ? `${u.payout_method.type}` : 'not set');
row('PAN on file', u?.pan_number ? 'yes' : 'no');
row('razorpay account', u?.razorpay_account_id ?? 'none');

h('BOOKINGS  (last 8)');
const bk = await db.collection('bookings').where('rider_id', '==', uid).limit(50).get();
const bookings = bk.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  .slice(0, 8);
if (bookings.length === 0) console.log('  none as a rider');
for (const b of bookings) {
  console.log(`  ${String(b.created_at).slice(0, 19)}  ${String(b.booking_status ?? '-').padEnd(11)} escrow=${String(b.escrow_status ?? '-').padEnd(9)} ${b.fare_amount ?? '?'}  ${ago(b.created_at)}`);
}

const rides = await db.collection('rides').where('driver_uid', '==', uid).limit(50).get();
console.log(`\n  rides offered as driver: ${rides.size}`);

// ── The point of the whole exercise ────────────────────────────────────────
h(problems.length ? `PROBLEMS FOUND (${problems.length})` : 'NO PROBLEMS DETECTED');
problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
console.log();
