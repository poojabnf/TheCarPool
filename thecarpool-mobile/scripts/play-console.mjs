#!/usr/bin/env node
/**
 * Play Console automation — no browser, no dependencies.
 *
 * Everything here runs through the Google Play Developer API v3 authenticated
 * with the `play-publisher@` service account key, so store graphics, track
 * promotion and rollout no longer need anyone clicking through the console.
 *
 * What the API can and cannot do (learned the hard way):
 *   CAN  — upload store graphics (icon, featureGraphic, screenshots),
 *          read/promote tracks, set rollout fraction, edit listing text.
 *   CANNOT — set app category or tags, or toggle Managed publishing. Those
 *          are console-only. With Managed publishing ON, `commit` sends
 *          changes for review; a human still presses Publish.
 *
 * Usage:
 *   node scripts/play-console.mjs status
 *   node scripts/play-console.mjs upload-graphics [--icon path] [--feature path]
 *   node scripts/play-console.mjs promote --to production --version 146 [--rollout 0.1]
 *
 * Add --dry-run to any mutating command to see the plan without committing.
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const KEY_PATH = process.env.PLAY_SA_KEY || resolve(ROOT, 'google-play-service-account.json');
const PACKAGE = process.env.PLAY_PACKAGE || 'com.thecarpool.app';
const LANG = 'en-US';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const UPLOAD_API = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3';

// ── auth ───────────────────────────────────────────────────────────────────
function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
  const key = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const sig = base64url(signer.sign(key.private_key));
  const assertion = `${header}.${claims}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── api helpers ────────────────────────────────────────────────────────────
async function api(token, path, { method = 'GET', body, raw, contentType } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function uploadImage(token, editId, imageType, filePath) {
  const bytes = readFileSync(filePath);
  const url = `${UPLOAD_API}/applications/${PACKAGE}/edits/${editId}/listings/${LANG}/${imageType}?uploadType=media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: bytes,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`upload ${imageType} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

const newEdit = (token) => api(token, `/applications/${PACKAGE}/edits`, { method: 'POST' });
const commitEdit = (token, id) =>
  api(token, `/applications/${PACKAGE}/edits/${id}:commit`, { method: 'POST' });
const deleteEdit = (token, id) =>
  api(token, `/applications/${PACKAGE}/edits/${id}`, { method: 'DELETE' }).catch(() => {});

// ── commands ───────────────────────────────────────────────────────────────
async function cmdStatus(token) {
  const edit = await newEdit(token);
  try {
    const tracks = await api(token, `/applications/${PACKAGE}/edits/${edit.id}/tracks`);
    console.log(`\nTracks for ${PACKAGE}:\n`);
    for (const t of tracks.tracks || []) {
      const rels = (t.releases || []).map((r) => {
        const codes = (r.versionCodes || []).join(',');
        const frac = r.userFraction != null ? ` @${(r.userFraction * 100).toFixed(0)}%` : '';
        return `      ${r.status.padEnd(10)} v${r.name || '?'} (code ${codes})${frac}`;
      });
      console.log(`  ${t.track}`);
      console.log(rels.length ? rels.join('\n') : '      (no releases)');
    }

    const listing = await api(token, `/applications/${PACKAGE}/edits/${edit.id}/listings/${LANG}`);
    console.log(`\nListing (${LANG}): "${listing.title}"`);
    // Image listing is best-effort: this endpoint 404s rather than returning an
    // empty list for some image types, which is not worth failing `status` over.
    for (const type of ['icon', 'featureGraphic']) {
      const r = await api(token, `/applications/${PACKAGE}/edits/${edit.id}/images/${LANG}/${type}`)
        .then((d) => (d.images || []).map((i) => i.sha256).join(', ') || '(none)')
        .catch(() => '(unavailable)');
      console.log(`  ${type.padEnd(15)} ${r}`);
    }
    console.log();
  } finally {
    await deleteEdit(token, edit.id); // read-only: never commit
  }
}

async function cmdUploadGraphics(token, args) {
  const iconPath = args.icon ? resolve(args.icon) : resolve(ROOT, 'assets/play-store-icon-512.png');
  const featPath = args.feature ? resolve(args.feature) : resolve(ROOT, 'assets/play-feature-graphic-1024x500.png');

  const edit = await newEdit(token);
  try {
    console.log(`edit ${edit.id}`);
    console.log(`  uploading icon           <- ${iconPath}`);
    const i = await uploadImage(token, edit.id, 'icon', iconPath);
    console.log(`    ok sha256=${i.image?.sha256}`);
    console.log(`  uploading featureGraphic <- ${featPath}`);
    const f = await uploadImage(token, edit.id, 'featureGraphic', featPath);
    console.log(`    ok sha256=${f.image?.sha256}`);

    if (args['dry-run']) {
      console.log('\n--dry-run: discarding edit, nothing changed.');
      await deleteEdit(token, edit.id);
      return;
    }
    await commitEdit(token, edit.id);
    console.log('\ncommitted. Managed publishing is ON, so this now sits in "Changes in review".');
  } catch (err) {
    await deleteEdit(token, edit.id);
    throw err;
  }
}

async function cmdPromote(token, args) {
  const to = args.to || 'production';
  const version = String(args.version || '');
  if (!version) throw new Error('--version <versionCode> is required');
  const rollout = args.rollout != null ? Number(args.rollout) : null;

  const edit = await newEdit(token);
  try {
    const existing = await api(token, `/applications/${PACKAGE}/edits/${edit.id}/tracks/${to}`).catch(() => null);
    console.log(`current ${to}:`, JSON.stringify(existing?.releases ?? [], null, 2));

    const release = {
      name: args.name || version,
      versionCodes: [version],
      status: rollout != null && rollout < 1 ? 'inProgress' : 'completed',
      ...(rollout != null && rollout < 1 ? { userFraction: rollout } : {}),
    };
    console.log(`\nplanned ${to} release:`, JSON.stringify(release, null, 2));

    if (args['dry-run']) {
      console.log('\n--dry-run: discarding edit, nothing changed.');
      await deleteEdit(token, edit.id);
      return;
    }

    await api(token, `/applications/${PACKAGE}/edits/${edit.id}/tracks/${to}`, {
      method: 'PUT',
      body: { track: to, releases: [release] },
    });
    await commitEdit(token, edit.id);
    console.log(`\ncommitted. ${version} is now on "${to}".`);
    console.log('Managed publishing is ON — press Publish in the console to make it live.');
  } catch (err) {
    await deleteEdit(token, edit.id);
    throw err;
  }
}

// ── main ───────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    }
  }
  return args;
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

try {
  const token = await getAccessToken();
  if (cmd === 'status') await cmdStatus(token);
  else if (cmd === 'upload-graphics') await cmdUploadGraphics(token, args);
  else if (cmd === 'promote') await cmdPromote(token, args);
  else {
    console.log('commands: status | upload-graphics | promote');
    process.exit(1);
  }
} catch (err) {
  console.error('\nFAILED:', err.message);
  process.exit(1);
}
