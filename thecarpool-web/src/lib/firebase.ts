import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAgdjbhzxkPTNX0TuAo8iIcglQ0q6-qmK8",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "thecarpool-fe636.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "thecarpool-fe636",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "thecarpool-fe636.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "953521578640",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:953521578640:web:6f5cd3c63a2ed35bf06e15",
  // measurementId is required for Analytics — add from Firebase Console > Project Settings > Your Apps > Measurement ID
  // Leave empty and Analytics will be silently disabled until you link a Google Analytics property
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || ""
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Initialize Analytics and Performance only on the client side.
// Both are wrapped in try/catch so missing GA4 config or unsupported
// environments fail silently instead of polluting the console.
export let analytics: any = null;
export let performance: any = null;

if (typeof window !== 'undefined') {
  // Analytics requires a linked Google Analytics (GA4) property in Firebase Console.
  // If not configured, the error is suppressed gracefully.
  import('firebase/analytics').then(({ getAnalytics, isSupported }) => {
    isSupported()
      .then((supported) => {
        if (supported && firebaseConfig.measurementId) {
          try {
            analytics = getAnalytics(app);
          } catch {
            // Silently ignore — GA4 not linked yet
          }
        }
      })
      .catch(() => { /* Analytics not supported in this environment */ });
  }).catch(() => {});

  // Performance Monitoring — also wrapped defensively
  import('firebase/performance').then(({ getPerformance }) => {
    try {
      performance = getPerformance(app);
    } catch {
      // Silently ignore — Performance Monitoring unavailable
    }
  }).catch(() => {});
}

export { app };
