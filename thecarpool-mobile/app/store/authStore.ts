import { create } from 'zustand';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';

export type KycStatus = 'none' | 'pending' | 'verified';

export interface UserProfile {
  name: string;
  phone: string;
  email?: string;
  employeeId?: string;
  company?: string;
  workLocation?: string;
  aadhaarLast4?: string;
  panNumber?: string;
  selfieVerified?: boolean;
  role?: 'rider' | 'partner';
}

interface AuthState {
  // Firebase auth
  firebaseUser: FirebaseAuthTypes.User | null;
  isLoggedIn: boolean;
  isAuthLoading: boolean; // true while Firebase checks initial state

  // KYC / onboarding
  kycStatus: KycStatus;
  onboardingStep: number;

  // App-level profile (populated during onboarding)
  userProfile: UserProfile | null;

  // Actions
  setFirebaseUser: (user: FirebaseAuthTypes.User | null) => void;
  setAuthLoading: (loading: boolean) => void;
  setUserProfile: (updates: Partial<UserProfile>) => void;
  setKycStatus: (status: KycStatus) => void;
  setOnboardingStep: (step: number) => void;
  completeOnboarding: () => void;
  reset: () => void;
}

const initialState = {
  firebaseUser: null,
  isLoggedIn: false,
  isAuthLoading: true,
  kycStatus: 'none' as KycStatus,
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

  setUserProfile: (updates) =>
    set((state) => ({
      userProfile: state.userProfile
        ? { ...state.userProfile, ...updates }
        : ({ ...updates } as UserProfile),
    })),

  setKycStatus: (status) => set({ kycStatus: status }),

  setOnboardingStep: (step) => set({ onboardingStep: step }),

  completeOnboarding: () =>
    set({ onboardingStep: 5 }), // kycStatus stays as-is; set by setKycStatus after backend confirms

  reset: () => set({ ...initialState, isAuthLoading: false }),
}));
