import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar, View, ActivityIndicator } from 'react-native';
import { useAuthStore } from './store/authStore';
import { auth } from './services/firebase';
import { registerForPushNotifications } from './services/notifications';
import { apiFetch } from './services/api';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isAuthLoading, setFirebaseUser, setKycStatus, setUserProfile } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  // Listen to Firebase auth state changes
  useEffect(() => {
    const unsubscribe = auth().onAuthStateChanged(async (user) => {
      setFirebaseUser(user);
      if (user) {
        // Register this device for push notifications once signed in.
        registerForPushNotifications().catch(() => { /* non-fatal */ });

        // Rehydrate KYC + profile from backend — fixes cold-start reset bug.
        try {
          const res = await apiFetch('/api/users/me');
          if (res.ok) {
            const data = await res.json();
            // Map backend kyc_status (VERIFIED/NONE/PENDING) to store KycStatus type
            if (data.kyc_status === 'VERIFIED' || data.onboarded === true) {
              setKycStatus('verified');
            } else if (data.kyc_status === 'PENDING') {
              setKycStatus('pending');
            }
            // Rehydrate profile fields if present
            if (data.name || data.company) {
              setUserProfile({
                name: data.name,
                phone: user.phoneNumber || '',
                email: data.email,
                company: data.company,
                employeeId: data.employeeId,
                workLocation: data.workLocation,
                role: data.role,
              });
            }
          }
        } catch {
          /* non-fatal — user proceeds with local state */
        }
      }
    });
    return unsubscribe;
  }, []);

  // Handle routing based on auth state
  useEffect(() => {
    if (isAuthLoading) return; // Wait for Firebase to resolve

    const inAuthGroup = segments[0] === '(auth)';

    if (!isLoggedIn && !inAuthGroup) {
      // Require sign-in, but nothing more — browsing is open after login.
      router.replace('/(auth)/login');
    } else if (isLoggedIn && inAuthGroup) {
      // Signed in: drop into the app. Verification is no longer a gate here;
      // it's enforced only at booking time (see the rider screen's handleBook).
      router.replace('/(tabs)');
    }
  }, [isLoggedIn, isAuthLoading, segments]);

  // Show splash/loading while Firebase checks persisted auth
  if (isAuthLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#080c14', alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar barStyle="light-content" backgroundColor="#080c14" />
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#080c14" />
      <AuthGuard>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#080c14' } }}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="trip/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="components/AiVoiceModal" options={{ presentation: 'modal' }} />
          <Stack.Screen name="components/KycUploadModal" options={{ presentation: 'modal' }} />
        </Stack>
      </AuthGuard>
    </>
  );
}
