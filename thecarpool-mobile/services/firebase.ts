/**
 * Firebase Service
 * ─────────────────────────────────────────────────────
 * @react-native-firebase auto-reads GoogleService-Info.plist (iOS)
 * and google-services.json (Android) — no manual init needed.
 *
 * SETUP REQUIRED:
 * 1. Place GoogleService-Info.plist in thecarpool-mobile/ root (iOS)
 * 2. Place google-services.json in thecarpool-mobile/ root (Android)
 * 3. Both files are downloaded from Firebase Console
 */

import auth from '@react-native-firebase/auth';

export { auth };

// Convenience: get current user
export const getCurrentUser = () => auth().currentUser;

// Convenience: sign out
export const signOut = () => auth().signOut();
