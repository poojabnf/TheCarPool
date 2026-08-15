import { create } from 'zustand';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';

export interface UserProfile {
  name: string;
  address?: string;
  phone: string;
  email?: string;
  employeeId?: string;
  company?: string;
  workLocation?: string;
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

  onboardingStep: number;

  // App-level profile (populated during onboarding)
  userProfile: UserProfile | null;

  // Actions
  setFirebaseUser: (user: FirebaseAuthTypes.User | null) => void;
  setAuthLoading: (loading: boolean) => void;
  setProfileHydrated: (hydrated: boolean) => void;
  skipProfileSetup: () => void;
  setUserProfile: (updates: Partial<UserProfile>) => void;
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

  setOnboardingStep: (step) => set({ onboardingStep: step }),

  completeOnboarding: () => set({ onboardingStep: 2 }),

  reset: () => set({ ...initialState, isAuthLoading: false }),
}));
