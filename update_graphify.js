const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Brand name replacements ───────────────────────────────────────────────
const files = ['GRAPH_REPORT.md', 'graph.json', 'manifest.json', 'graph.html'];

files.forEach(f => {
  const p = 'graphify-out/' + f;
  if (fs.existsSync(p)) {
    let c = fs.readFileSync(p, 'utf8');
    c = c.replace(/SafarMate/g, 'TheCarPool')
         .replace(/Safarmate/g, 'TheCarPool')
         .replace(/safarmate/g, 'thecarpool');
    fs.writeFileSync(p, c);
    console.log(`✓ Replaced brand names in ${f}`);
  } else {
    console.log(`⚠ Skipped (not found): ${f}`);
  }
});

// ─── Update manifest checksums for changed/new files ──────────────────────
const manifestPath = 'graphify-out/manifest.json';
if (!fs.existsSync(manifestPath)) {
  console.log('⚠ manifest.json not found — skipping checksum update.');
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// All source files that should be tracked (normalized to forward slashes)
const trackedFiles = [
  // Backend
  'thecarpool-backend/src/server.ts',
  'thecarpool-backend/src/lib/firestore.ts',
  'thecarpool-backend/src/routes/ai.ts',
  'thecarpool-backend/src/routes/bookings.ts',
  'thecarpool-backend/src/routes/classifieds.ts',
  'thecarpool-backend/src/routes/geo.ts',
  'thecarpool-backend/src/routes/payments.ts',
  'thecarpool-backend/src/routes/rides.ts',
  'thecarpool-backend/src/routes/safety.ts',
  'thecarpool-backend/src/routes/sustainability.ts',
  'thecarpool-backend/src/sockets/telemetry.ts',
  'thecarpool-backend/src/queue/processor.ts',
  'thecarpool-backend/src/services/firestoreSeed.ts',
  // Frontend
  'thecarpool-web/src/app/page.tsx',
  'thecarpool-web/src/app/onboarding/page.tsx',
  'thecarpool-web/src/app/customer/page.tsx',
  'thecarpool-web/src/app/admin/page.tsx',
  'thecarpool-web/src/app/partner/page.tsx',
  'thecarpool-web/src/components/Dashboard.tsx',
  'thecarpool-web/src/components/CustomerDashboard.tsx',
  'thecarpool-web/src/components/VendorDashboard.tsx',
  'thecarpool-web/src/components/AuthModal.tsx',
  'thecarpool-web/src/components/ESGMetricsPanel.tsx',
  'thecarpool-web/src/context/AuthContext.tsx',
  'thecarpool-web/src/lib/firebase.ts',
  'thecarpool-web/next.config.ts',
  // Mobile
  'thecarpool-mobile/app/(tabs)/home.tsx',
  'thecarpool-mobile/app/(tabs)/kyc.tsx',
  'thecarpool-mobile/app/_layout.tsx',
  'thecarpool-mobile/app/trip/[id].tsx',
  // AI
  'thecarpool-ai/app/main.py',
  'thecarpool-ai/app/routes/twilio_voice.py',
  'thecarpool-ai/app/services/claude_parser.py',
  // Infra
  'start-dev.ps1',
  'docker-compose.yml',
  'vercel.json',
  'package.json',
];

function crc32(str) {
  // Simple CRC32 approximation using Node's built-in hash
  return parseInt(crypto.createHash('md5').update(str).digest('hex').slice(0, 8), 16);
}

let added = 0, updated = 0, missing = 0;

trackedFiles.forEach(rel => {
  const absPath = path.resolve(rel);
  const manifestKey = absPath.replace(/\//g, '\\');

  if (!fs.existsSync(absPath)) {
    missing++;
    return;
  }

  const content = fs.readFileSync(absPath, 'utf8');
  const checksum = crc32(content);

  if (manifest[manifestKey] === undefined) {
    manifest[manifestKey] = checksum;
    added++;
  } else if (manifest[manifestKey] !== checksum) {
    manifest[manifestKey] = checksum;
    updated++;
  }
});

// Update word count metadata
const totalWords = trackedFiles
  .filter(f => fs.existsSync(path.resolve(f)))
  .reduce((sum, f) => {
    const words = fs.readFileSync(path.resolve(f), 'utf8').split(/\s+/).filter(Boolean).length;
    return sum + words;
  }, 0);

manifest['__graphify_meta__'] = { total_words: totalWords };

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`\n✓ Manifest updated:`);
console.log(`  ${added} new file(s) added`);
console.log(`  ${updated} file(s) with changed checksums`);
console.log(`  ${missing} file(s) not found (skipped)`);
console.log(`  Total tracked words: ${totalWords.toLocaleString()}`);
console.log('\nUpdate complete.');
