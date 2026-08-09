#!/usr/bin/env node
/**
 * Submit an App Store version for review.
 *
 * Uses the current reviewSubmissions flow (the older
 * appStoreVersionSubmissions endpoint is deprecated):
 *   1. find or create a reviewSubmission for the app
 *   2. add the version to it as a reviewSubmissionItem
 *   3. PATCH submitted:true
 *
 * ⚠ This version is set to releaseType AFTER_APPROVAL — Apple releases it to
 * every user the moment review passes, with no further confirmation. Run this
 * only when that is genuinely intended.
 *
 * Usage:
 *   node scripts/asc-submit.mjs            # dry run: shows what it would do
 *   node scripts/asc-submit.mjs --apply
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER = process.env.ASC_ISSUER_ID;
const KEY = readFileSync(process.env.ASC_KEY_PATH, 'utf8');
const APPLY = process.argv.includes('--apply');

const APP_ID = process.env.ASC_APP_ID || '6772426075';
const VERSION_ID = process.env.ASC_VERSION_ID || '02678109-264b-4e5d-a254-644be328a4fe';

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
  if (!res.ok) {
    const detail = d?.errors?.map((e) => `${e.title} — ${e.detail}`).join('\n  ') || t;
    throw new Error(`${method} ${path} -> ${res.status}\n  ${detail}`);
  }
  return d;
}

// ── Pre-flight ─────────────────────────────────────────────────────────────
const version = await api(`/appStoreVersions/${VERSION_ID}`);
const attrs = version.data.attributes;
console.log(`version ${attrs.versionString}  state=${attrs.appStoreState}  release=${attrs.releaseType}`);

const build = await api(`/appStoreVersions/${VERSION_ID}/build`).catch(() => ({ data: null }));
if (!build.data) throw new Error('No build attached to this version — run asc-prepare.mjs first.');
console.log('build attached:', build.data.id);

if (attrs.appStoreState !== 'PREPARE_FOR_SUBMISSION') {
  console.log(`\nNothing to do: state is ${attrs.appStoreState}, not PREPARE_FOR_SUBMISSION.`);
  process.exit(0);
}

if (!APPLY) {
  console.log('\nDry run. Pass --apply to submit for review.');
  console.log('NOTE: releaseType is ' + attrs.releaseType +
    (attrs.releaseType === 'AFTER_APPROVAL'
      ? ' — approval releases it to ALL users automatically.'
      : '.'));
  process.exit(0);
}

// ── Submit ─────────────────────────────────────────────────────────────────
// Reuse an open submission if one exists; creating a second returns a
// confusing 409 rather than doing anything useful.
const existing = await api(`/reviewSubmissions?filter[app]=${APP_ID}&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW&limit=1`)
  .catch(() => ({ data: [] }));

let submissionId = existing.data?.[0]?.id;
if (submissionId) {
  console.log('reusing open review submission', submissionId);
} else {
  const created = await api('/reviewSubmissions', {
    method: 'POST',
    body: {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      },
    },
  });
  submissionId = created.data.id;
  console.log('created review submission', submissionId);
}

await api('/reviewSubmissionItems', {
  method: 'POST',
  body: {
    data: {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: VERSION_ID } },
      },
    },
  },
}).then(() => console.log('✓ version added to the submission'))
  .catch((e) => {
    // Already attached is fine; anything else is not.
    if (/already/i.test(e.message)) console.log('version already in the submission');
    else throw e;
  });

await api(`/reviewSubmissions/${submissionId}`, {
  method: 'PATCH',
  body: { data: { type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } } },
});
console.log('\n✓ SUBMITTED for App Store review.');
console.log('Apple typically reviews within 24–48h. releaseType is', attrs.releaseType + '.');
