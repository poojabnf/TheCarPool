#!/usr/bin/env node
/**
 * App Store Connect automation — the iOS counterpart to play-console.mjs.
 * No browser, no dependencies.
 *
 * WHY THIS EXISTS
 * `eas submit` uploads a build to App Store Connect but does NOT attach it to a
 * TestFlight group. An internal group set to "Automatic for Xcode Builds" only
 * auto-distributes builds uploaded from Xcode, so API-uploaded builds (which is
 * what EAS produces) sit in App Store Connect, fully processed, visible to
 * nobody. That is why testers stayed on an old build while newer ones piled up.
 *
 * WHAT IS ACTUALLY TRUE (measured, not assumed)
 * An INTERNAL group with hasAccessToAllBuilds:true receives every processed
 * build automatically — Apple rejects per-build assignment to internal groups
 * outright ("Cannot add internal group to a build"). So for internal testing
 * there is nothing to attach: once a build reaches internalBuildState
 * IN_BETA_TESTING it is already installable, and a tester still on an older
 * version simply has not updated. `status` shows that state so you can tell
 * "not distributed" from "not yet installed" without guessing.
 *
 * `distribute` therefore applies to EXTERNAL groups, where builds are assigned
 * explicitly and go through Beta App Review.
 *
 * CREDENTIALS — create these once:
 *   App Store Connect -> Users and Access -> Integrations -> App Store Connect API
 *   -> generate a key with the "App Manager" role, download the .p8 (one-time).
 * Then set:
 *   ASC_KEY_ID=XXXXXXXXXX
 *   ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *   ASC_KEY_PATH=./AuthKey_XXXXXXXXXX.p8      (gitignored — never commit it)
 *
 * Usage:
 *   node scripts/appstore.mjs status
 *   node scripts/appstore.mjs groups
 *   node scripts/appstore.mjs distribute --build 150
 *   node scripts/appstore.mjs distribute --latest
 *   (add --group "Internal Testing" to target a specific group)
 */
import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const API = 'https://api.appstoreconnect.apple.com/v1';

const APP_ID = process.env.ASC_APP_ID || '6772426075';
const KEY_ID = process.env.ASC_KEY_ID || '';
const ISSUER_ID = process.env.ASC_ISSUER_ID || '';
const KEY_PATH = process.env.ASC_KEY_PATH || resolve(ROOT, `AuthKey_${KEY_ID}.p8`);

function requireCreds() {
  const missing = [];
  if (!KEY_ID) missing.push('ASC_KEY_ID');
  if (!ISSUER_ID) missing.push('ASC_ISSUER_ID');
  if (!existsSync(KEY_PATH)) missing.push(`the .p8 key at ${KEY_PATH}`);
  if (missing.length) {
    console.error(
      'Missing App Store Connect credentials: ' + missing.join(', ') + '\n\n' +
      'Create a key at App Store Connect -> Users and Access -> Integrations ->\n' +
      'App Store Connect API, with the App Manager role, then set ASC_KEY_ID,\n' +
      'ASC_ISSUER_ID and ASC_KEY_PATH. The .p8 downloads once and cannot be\n' +
      're-downloaded, so keep it somewhere safe and out of git.'
    );
    process.exit(1);
  }
}

// ── auth ───────────────────────────────────────────────────────────────────
const b64u = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * App Store Connect requires an ES256 JWT whose signature is JOSE-encoded
 * (r||s). Node's default EC output is DER, which Apple rejects with a generic
 * 401 — `dsaEncoding: 'ieee-p1363'` is what produces the format Apple wants.
 */
function token() {
  const key = readFileSync(KEY_PATH, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const payload = b64u(JSON.stringify({
    iss: ISSUER_ID,
    iat: now,
    exp: now + 15 * 60, // Apple rejects anything beyond 20 minutes
    aud: 'appstoreconnect-v1',
  }));
  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const sig = signer.sign({ key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64u(sig)}`;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const detail = data?.errors?.map((e) => `${e.title}: ${e.detail}`).join('; ') || JSON.stringify(data);
    throw new Error(`${method} ${path} -> ${res.status}: ${detail}`);
  }
  return data;
}

// ── helpers ────────────────────────────────────────────────────────────────
const listBuilds = (limit = 10) =>
  api(`/builds?filter[app]=${APP_ID}&sort=-version&limit=${limit}&include=preReleaseVersion,buildBetaDetail`);

const listGroups = () => api(`/betaGroups?filter[app]=${APP_ID}&limit=50`);

async function findBuild(version) {
  const data = await listBuilds(50);
  const b = data.data.find((x) => String(x.attributes.version) === String(version));
  if (!b) throw new Error(`Build ${version} not found in App Store Connect.`);
  return b;
}

function shortVersionOf(build, included) {
  const relId = build.relationships?.preReleaseVersion?.data?.id;
  const pre = (included || []).find((i) => i.id === relId);
  return pre?.attributes?.version || '?';
}

// ── commands ───────────────────────────────────────────────────────────────
async function cmdStatus() {
  const data = await listBuilds(10);
  const detail = Object.fromEntries(
    (data.included || []).filter((i) => i.type === 'buildBetaDetails').map((i) => [i.id, i.attributes])
  );
  console.log(`\nBuilds for app ${APP_ID}:\n`);
  for (const b of data.data) {
    const a = b.attributes;
    const d = detail[b.relationships?.buildBetaDetail?.data?.id] || {};
    // internal=IN_BETA_TESTING means testers can install it NOW. Anyone still
    // on an older version simply hasn't updated — which is not the same thing
    // as the build not being distributed, and the difference is worth seeing.
    console.log(
      `  ${shortVersionOf(b, data.included).padEnd(8)} (${String(a.version).padEnd(4)}) ` +
      `${String(a.processingState).padEnd(7)} internal=${String(d.internalBuildState || '?').padEnd(17)}` +
      ` external=${d.externalBuildState || '?'}`
    );
  }
  const groups = await listGroups();
  console.log('\nTestFlight groups:');
  for (const g of groups.data) {
    console.log(`  ${g.attributes.name}  (internal=${g.attributes.isInternalGroup})  id=${g.id}`);
  }
  console.log();
}

async function cmdGroups() {
  const groups = await listGroups();
  for (const g of groups.data) {
    const builds = await api(`/betaGroups/${g.id}/relationships/builds?limit=200`).catch(() => ({ data: [] }));
    console.log(`${g.attributes.name}: ${builds.data.length} builds attached, id=${g.id}`);
  }
}

async function cmdDistribute(args) {
  const groups = await listGroups();
  const group = args.group
    ? groups.data.find((g) => g.attributes.name.toLowerCase() === String(args.group).toLowerCase())
    : groups.data.find((g) => g.attributes.isInternalGroup) || groups.data[0];
  if (!group) throw new Error('No TestFlight group found.');

  let build;
  if (args.latest) {
    const data = await listBuilds(10);
    // Only a fully processed build can be distributed.
    build = data.data.find((b) => b.attributes.processingState === 'VALID');
    if (!build) throw new Error('No VALID build available yet — is it still processing?');
  } else {
    if (!args.build) throw new Error('Pass --build <versionCode> or --latest');
    build = await findBuild(args.build);
  }

  const state = build.attributes.processingState;
  if (state !== 'VALID') {
    throw new Error(`Build ${build.attributes.version} is ${state}, not VALID — wait for processing to finish.`);
  }

  if (group.attributes.isInternalGroup) {
    // Apple rejects this with a 422; say so plainly rather than letting the
    // API error look like a broken script.
    console.log(
      `"${group.attributes.name}" is an INTERNAL group — Apple distributes every
` +
      `processed build to it automatically and refuses explicit assignment.
` +
      `Build ${build.attributes.version} is ${build.attributes.processingState}; run \`status\` to see its
` +
      `internalBuildState. IN_BETA_TESTING means testers can install it now and
` +
      `anyone on an older version simply has not updated yet.`
    );
    return;
  }

  console.log(`Attaching build ${build.attributes.version} to "${group.attributes.name}"…`);
  if (args['dry-run']) {
    console.log('--dry-run: nothing changed.');
    return;
  }

  await api(`/betaGroups/${group.id}/relationships/builds`, {
    method: 'POST',
    body: { data: [{ type: 'builds', id: build.id }] },
  });
  console.log(`done — build ${build.attributes.version} is now available to testers in "${group.attributes.name}".`);
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
  requireCreds();
  if (cmd === 'status') await cmdStatus();
  else if (cmd === 'groups') await cmdGroups();
  else if (cmd === 'distribute') await cmdDistribute(args);
  else {
    console.log('commands: status | groups | distribute --build <n> | distribute --latest');
    process.exit(1);
  }
} catch (err) {
  console.error('\nFAILED:', err.message);
  process.exit(1);
}
