import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const required = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
] as const;

// Warn (don't throw) on missing config. Throwing at module-evaluation time
// breaks `next build` static prerendering for pages that don't even use
// Firebase (e.g. /support, /privacy). Firebase-dependent pages will still
// surface a clear auth error at runtime if these aren't configured.
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.warn(`[firebase] Missing env vars (set them in Vercel): ${missing.join(', ')}`);
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Analytics and Performance only run client-side
if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
  Promise.all([
    import('firebase/analytics'),
    import('firebase/performance'),
  ]).then(([{ getAnalytics }, { getPerformance }]) => {
    try {
      getAnalytics(app);
      getPerformance(app);
    } catch {
      // non-fatal — analytics/perf not available in all environments
    }
  });
}
