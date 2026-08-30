/**
 * Notification records written since a timestamp, one line each, for the live
 * log watcher. Temporary tooling — deleted when the session's testing is done.
 *
 * Output: <dedupe-key>|<human line>
 */
import admin from 'firebase-admin';

admin.initializeApp({ projectId: process.env.GCP_PROJECT || 'thecarpool-fe636' });
const db = admin.firestore();

const since = process.argv[2] || new Date(Date.now() - 120000).toISOString();

const snap = await db
  .collection('notifications')
  .where('created_at', '>=', since)
  .limit(50)
  .get();

const rows = snap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

for (const n of rows) {
  const t = String(n.created_at).slice(11, 19);
  const type = String(n.type ?? '-').padEnd(26);
  const who = String(n.user_id ?? '?').slice(0, 10);
  console.log(`${n.id}|${t}  ${type} -> ${who}  ${String(n.title ?? '').slice(0, 36)}`);
}
