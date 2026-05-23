import { create } from 'zustand';

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
}

interface AuthState {
  isLoggedIn: boolean;
  kycStatus: KycStatus;
  onboardingStep: number; // 0 = not started, 1–4 = current step, 5 = done
  user: UserProfile | null;

  // Actions
  login: (phone: string) => void;
  logout: () => void;
  setUser: (user: Partial<UserProfile>) => void;
  setKycStatus: (status: KycStatus) => void;
  setOnboardingStep: (step: number) => void;
  completeOnboarding: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isLoggedIn: false,
  kycStatus: 'none',
  onboardingStep: 0,
  user: null,

  login: (phone: string) =>
    set({
      isLoggedIn: true,
      user: { name: '', phone },
      kycStatus: 'none',
    }),

  logout: () =>
    set({
      isLoggedIn: false,
      user: null,
      kycStatus: 'none',
      onboardingStep: 0,
    }),

  setUser: (updates: Partial<UserProfile>) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...updates } : ({ ...updates } as UserProfile),
    })),

  setKycStatus: (status: KycStatus) => set({ kycStatus: status }),

  setOnboardingStep: (step: number) => set({ onboardingStep: step }),

  completeOnboarding: () =>
    set({ kycStatus: 'verified', onboardingStep: 5 }),
}));
