import * as admin from 'firebase-admin';

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

if (admin.apps.length === 0) {
  if (serviceAccountPath) {
    try {
      // Load service account from path if specified
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'thecarpool-fe636'
      });
      console.log('[FIREBASE] Initialized Admin SDK using service account certificate file.');
    } catch (err: any) {
      console.warn('[FIREBASE] Service account path provided but failed to load, falling back:', err.message);
      admin.initializeApp({
        projectId: 'thecarpool-fe636'
      });
    }
  } else {
    // Default initialization (works with Application Default Credentials in GCP/Vercel or emulation locally)
    admin.initializeApp({
      projectId: 'thecarpool-fe636'
    });
    console.log('[FIREBASE] Initialized Admin SDK with default credentials/emulator support.');
  }
}

export const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true }); // Avoid errors when uploading objects with undefined values

export const storage = admin.storage();
