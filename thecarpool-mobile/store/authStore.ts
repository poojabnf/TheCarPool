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
  // True once the backend profile fetch has settled. Routing no longer waits
  // on it — nothing gates entry on a profile — but screens use it to tell
  // "still loading" apart from "genuinely has no name".
  isProfileHydrated: boolean;

  onboardingStep: number;

  // App-level profile (populated during onboarding)
  userProfile: UserProfile | null;

  // Global activity sync signal
  activityRefreshEpoch: number;

  // Actions
  setFirebaseUser: (user: FirebaseAuthTypes.User | null) => void;
  setAuthLoading: (loading: boolean) => void;
  setProfileHydrated: (hydrated: boolean) => void;
  setUserProfile: (updates: Partial<UserProfile>) => void;
  setOnboardingStep: (step: number) => void;
  completeOnboarding: () => void;
  triggerActivityRefresh: () => void;
  reset: () => void;
}

const initialState = {
  firebaseUser: null,
  isLoggedIn: false,
  isAuthLoading: true,
  isProfileHydrated: false,
  onboardingStep: 0,
  userProfile: null,
  activityRefreshEpoch: 0,
};

export const useAuthStore = create<AuthState>((set) => ({
  ...initialState,

  /**
   * Adopt a new Firebase user -- and drop the previous one's profile with it.
   *
   * The profile used to survive an account switch, because hydration merges
   * field-by-field and skips anything the new account left blank. Signing in
   * as a second person on the same handset therefore produced a profile that
   * belonged to nobody: their name over the previous account's phone number,
   * each field from whichever identity last supplied it. On screen that read
   * as one coherent person, which is what made it so hard to see.
   *
   * A uid change is an identity change, so everything downstream of identity
   * goes with it. Only a *different* uid clears -- token refreshes and app
   * resumes hand back the same uid constantly, and wiping on those would
   * throw the profile away several times a session.
   */
  setFirebaseUser: (user) =>
    set((state) => {
      const switched =
        state.firebaseUser?.uid != null &&
        user?.uid !== state.firebaseUser.uid;
      return {
        firebaseUser: user,
        isLoggedIn: user !== null,
        isAuthLoading: false,
        ...(switched
          ? {
              userProfile: null,
              isProfileHydrated: false,
              onboardingStep: 0,
            }
          : {}),
      };
    }),

  setAuthLoading: (loading) => set({ isAuthLoading: loading }),

  setProfileHydrated: (hydrated) => set({ isProfileHydrated: hydrated }),

  setUserProfile: (updates) =>
    set((state) => ({
      userProfile: state.userProfile
        ? { ...state.userProfile, ...updates }
        : ({ ...updates } as UserProfile),
    })),

  setOnboardingStep: (step) => set({ onboardingStep: step }),

  completeOnboarding: () => set({ onboardingStep: 2 }),

  triggerActivityRefresh: () =>
    set((state) => ({ activityRefreshEpoch: state.activityRefreshEpoch + 1 })),

  reset: () => set({ ...initialState, isAuthLoading: false }),
}));
