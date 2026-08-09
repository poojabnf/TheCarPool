#!/usr/bin/env node
/**
 * Delete KYC document images stored under the OLD path.
 *
 * WHY THIS EXISTS
 * Identity documents now live under `kyc-documents/{uid}/...`, which a GCS
 * Object Lifecycle rule deletes after 15 days. Everything uploaded before that
 * change sits under `users/{uid}/kyc/...` — a path the lifecycle rule cannot
 * cover, because a literal prefix cannot wildcard the uid in the middle. Those
 * files are therefore kept forever unless something deletes them. This is that
 * something. It is a one-off cleanup, not a schedule.
 *
 * IT DELETES USER DATA AND CANNOT BE UNDONE.
 * It is a dry run unless you pass --apply. Read the listing first.
 *
 * Usage:
 *   node scripts/purge-legacy-kyc.mjs                    # list what would go
 *   node scripts/purge-legacy-kyc.mjs --apply            # actually delete
 *   node scripts/purge-legacy-kyc.mjs --older-than 15    # only files older than N days
 *   node scripts/purge-legacy-kyc.mjs --bucket other-bucket
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-adminsdk.json,
 * or any ADC principal with storage.objects.list + storage.objects.delete.
 */
import admin from 'firebase-admin';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const APPLY = has('--apply');
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'thecarpool-fe636';
const BUCKET = valueOf('--bucket', process.env.STORAGE_BUCKET || `${PROJECT}.firebasestorage.app`);
const OLDER_THAN_DAYS = Number(valueOf('--older-than', '0'));

// Only ever this prefix. The current path (kyc-documents/) is handled by the
// lifecycle rule and must not be touched here.
const LEGACY_PREFIX = 'users/';
const LEGACY_SEGMENT = '/kyc/';

const rupees = (n) => n.toLocaleString('en-IN');
const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2);

async function main() {
  admin.initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
  const bucket = admin.storage().bucket();

  console.log(`Bucket:     gs://${BUCKET}`);
  console.log(`Looking for: ${LEGACY_PREFIX}{uid}${LEGACY_SEGMENT}...`);
  if (OLDER_THAN_DAYS > 0) console.log(`Age filter:  older than ${OLDER_THAN_DAYS} days`);
  console.log(APPLY ? 'Mode:       APPLY — files will be deleted\n' : 'Mode:       DRY RUN — nothing will be deleted (pass --apply)\n');

  // Listing all of users/ and filtering is the only option: GCS prefixes are
  // literal, and the uid sits between the two parts we care about.
  const [files] = await bucket.getFiles({ prefix: LEGACY_PREFIX });

  const cutoff = OLDER_THAN_DAYS > 0
    ? Date.now() - OLDER_THAN_DAYS * 24 * 60 * 60 * 1000
    : null;

  const targets = files.filter((f) => {
    if (!f.name.includes(LEGACY_SEGMENT)) return false;
    if (cutoff === null) return true;
    const updated = Date.parse(f.metadata?.updated ?? f.metadata?.timeCreated ?? '');
    return Number.isFinite(updated) && updated < cutoff;
  });

  if (targets.length === 0) {
    console.log(`Nothing to purge (scanned ${rupees(files.length)} objects under ${LEGACY_PREFIX}).`);
    return;
  }

  let bytes = 0;
  const owners = new Set();
  for (const f of targets) {
    bytes += Number(f.metadata?.size ?? 0);
    owners.add(f.name.split('/')[1] ?? '?');
    console.log(`  ${f.name}  (${mb(Number(f.metadata?.size ?? 0))} MB, updated ${f.metadata?.updated ?? '?'})`);
  }
  console.log(`\n${rupees(targets.length)} file(s), ${owners.size} user(s), ${mb(bytes)} MB total.`);

  if (!APPLY) {
    console.log('\nDry run — nothing deleted. Re-run with --apply to delete these.');
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const f of targets) {
    try {
      await f.delete();
      deleted += 1;
    } catch (err) {
      failed += 1;
      console.error(`  FAILED ${f.name}: ${err.message}`);
    }
  }
  console.log(`\nDeleted ${rupees(deleted)} file(s).${failed ? ` ${failed} failed.` : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
