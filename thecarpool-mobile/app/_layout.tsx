import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'react-native';
import { useAuthStore } from './store/authStore';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';

    if (!isLoggedIn && !inAuthGroup) {
      // Not logged in → push to login
      router.replace('/(auth)/login');
    } else if (isLoggedIn && inAuthGroup) {
      // Already logged in → go to tabs
      router.replace('/(tabs)');
    }
  }, [isLoggedIn, segments]);

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
