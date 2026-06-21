import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { c } from '../theme/tokens';
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
      <View style={{ flex: 1, backgroundColor: c.bgApp, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar barStyle="dark-content" backgroundColor={c.bgApp} />
        <ActivityIndicator size="large" color={c.accent} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  // Proceed once fonts resolve OR fail — never hard-block the app on font
  // loading (an OTA font-asset failure must not brick the launch screen; RN
  // falls back to the system font when a family is unavailable).
  if (!fontsLoaded && !fontError) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bgApp, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={c.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={c.bgApp} />
      <AuthGuard>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bgApp } }}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="trip/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="confirm" options={{ headerShown: false }} />
          <Stack.Screen name="components/AiVoiceModal" options={{ presentation: 'modal' }} />
          <Stack.Screen name="components/KycUploadModal" options={{ presentation: 'modal' }} />
        </Stack>
      </AuthGuard>
    </SafeAreaProvider>
  );
}
