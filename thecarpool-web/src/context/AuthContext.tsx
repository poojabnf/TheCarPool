"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { 
  User, 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut as firebaseSignOut,
  deleteUser as firebaseDeleteUser,
  RecaptchaVerifier,
  signInWithPhoneNumber as firebaseSignInWithPhoneNumber,
  ConfirmationResult
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { apiFetch } from '../lib/api';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  setupRecaptcha: (containerId: string) => RecaptchaVerifier;
  sendOtpCode: (phoneNumber: string, recaptchaVerifier: RecaptchaVerifier) => Promise<ConfirmationResult>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Track the active reCAPTCHA verifier so we can clear it instead of leaking
  // a new instance on every modal open/close.
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => {
      unsubscribe();
      recaptchaRef.current?.clear();
      recaptchaRef.current = null;
    };
  }, []);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Google Sign In Error:", error);
      alert(`Sign in failed: ${error.message || error.code || error}`);
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  const deleteAccount = async () => {
    if (!auth.currentUser) throw new Error('No authenticated user.');
    const uid = auth.currentUser.uid;

    // 1. Call the backend to delete all Firestore data associated with this user.
    // apiFetch attaches the Firebase ID token so the backend can authorize the deletion.
    await apiFetch('/api/safety/account', {
      method: 'DELETE',
      body: JSON.stringify({ user_id: uid }),
    });

    // 2. Delete Firebase Auth account on the client side
    await firebaseDeleteUser(auth.currentUser);

    // 3. Clear any local onboarding state
    localStorage.removeItem(`thecarpool_onboarded_${uid}`);
  };

  const setupRecaptcha = (containerId: string) => {
    // Clear any previous verifier before creating a new one so instances
    // don't accumulate across repeated sign-in attempts.
    recaptchaRef.current?.clear();
    const verifier = new RecaptchaVerifier(auth, containerId, {
      size: 'invisible',
    });
    recaptchaRef.current = verifier;
    return verifier;
  };

  const sendOtpCode = async (phoneNumber: string, recaptchaVerifier: RecaptchaVerifier) => {
    return await firebaseSignInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut, deleteAccount, setupRecaptcha, sendOtpCode }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
