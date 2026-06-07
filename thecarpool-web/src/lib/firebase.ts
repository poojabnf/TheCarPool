import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAgdjbhzxkPTNX0TuAo8iIcglQ0q6-qmK8",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "thecarpool-fe636.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "thecarpool-fe636",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "thecarpool-fe636.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "953521578640",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:953521578640:web:6f5cd3c63a2ed35bf06e15"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Initialize Analytics and Performance only on the client side
export let analytics: any = null;
export let performance: any = null;

if (typeof window !== 'undefined') {
  import('firebase/analytics').then(({ getAnalytics, isSupported }) => {
    isSupported().then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
      }
    });
  });
  import('firebase/performance').then(({ getPerformance }) => {
    performance = getPerformance(app);
  });
}

export { app };
