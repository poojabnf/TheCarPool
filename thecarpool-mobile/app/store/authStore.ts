import { create } from 'zustand';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';

export type KycStatus = 'none' | 'pending' | 'verified';

/**
 * What this user is allowed to do, as decided by the server. Mirrors
 * lib/verification on the backend — the app renders it, it never re-derives
 * the rules, so the two can't drift apart.
 */
export interface Verification {
  level: 1 | 2;
  id_verified: boolean;
  licence_verified: boolean;
  can_book: boolean;
  can_offer_rides: boolean;
}

export interface UserProfile {
  name: string;
  address?: string;
  phone: string;
  email?: string;
  employeeId?: string;
  company?: string;
  workLocation?: string;
  aadhaarLast4?: string;
  panNumber?: string;
  selfieVerified?: boolean;
  role?: 'rider' | 'partner';
  photoUrl?: string;
}

interface AuthState {
  // Firebase auth
  firebaseUser: FirebaseAuthTypes.User | null;
  isLoggedIn: boolean;
  isAuthLoading: boolean; // true while Firebase checks initial state
  // True once the backend profile fetch has settled. Routing must wait for
  // this: Firebase resolves first, so without it a fully-onboarded user is
  // briefly seen as having no profile and gets bounced to profile-setup.
  isProfileHydrated: boolean;
  // Set when the user taps "Skip for now" on profile setup, so the router
  // stops forcing them back into it for the rest of the session.
  profileSetupSkipped: boolean;

  // KYC / onboarding
  kycStatus: KycStatus;
  onboardingStep: number;

  // App-level profile (populated during onboarding)
  userProfile: UserProfile | null;
  verification: Verification | null;

  // Actions
  setFirebaseUser: (user: FirebaseAuthTypes.User | null) => void;
  setAuthLoading: (loading: boolean) => void;
  setProfileHydrated: (hydrated: boolean) => void;
  skipProfileSetup: () => void;
  setUserProfile: (updates: Partial<UserProfile>) => void;
  setKycStatus: (status: KycStatus) => void;
  setVerification: (v: Verification | null) => void;
  setOnboardingStep: (step: number) => void;
  completeOnboarding: () => void;
  reset: () => void;
}

const initialState = {
  firebaseUser: null,
  isLoggedIn: false,
  isAuthLoading: true,
  isProfileHydrated: false,
  profileSetupSkipped: false,
  kycStatus: 'none' as KycStatus,
  verification: null as Verification | null,
  onboardingStep: 0,
  userProfile: null,
};

export const useAuthStore = create<AuthState>((set) => ({
  ...initialState,

  setFirebaseUser: (user) =>
    set({
      firebaseUser: user,
      isLoggedIn: user !== null,
      isAuthLoading: false,
    }),

  setAuthLoading: (loading) => set({ isAuthLoading: loading }),

  setProfileHydrated: (hydrated) => set({ isProfileHydrated: hydrated }),

  skipProfileSetup: () => set({ profileSetupSkipped: true }),

  setUserProfile: (updates) =>
    set((state) => ({
      userProfile: state.userProfile
        ? { ...state.userProfile, ...updates }
        : ({ ...updates } as UserProfile),
    })),

  setKycStatus: (status) => set({ kycStatus: status }),

  setVerification: (v) => set({ verification: v }),

  setOnboardingStep: (step) => set({ onboardingStep: step }),

  completeOnboarding: () =>
    set({ onboardingStep: 5 }), // kycStatus stays as-is; set by setKycStatus after backend confirms

  reset: () => set({ ...initialState, isAuthLoading: false }),
}));
