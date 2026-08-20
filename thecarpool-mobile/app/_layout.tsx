import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar, View, ActivityIndicator, Text as RNText, TextInput as RNTextInput } from 'react-native';
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

// Cap Dynamic Type scaling app-wide. Text still scales for accessibility, but
// is bounded to 1.3x so very large system-font settings can't overflow the
// fixed-height controls (buttons, inputs), the tab bar, or fare rows. Runs once
// at import; individual components can still override per-element.
const TextDefaults = RNText as unknown as { defaultProps?: { maxFontSizeMultiplier?: number } };
TextDefaults.defaultProps = { ...(TextDefaults.defaultProps || {}), maxFontSizeMultiplier: 1.3 };
const InputDefaults = RNTextInput as unknown as { defaultProps?: { maxFontSizeMultiplier?: number } };
InputDefaults.defaultProps = { ...(InputDefaults.defaultProps || {}), maxFontSizeMultiplier: 1.3 };

function AuthGuard({ children }: { children: React.ReactNode }) {
  // Profile hydration still runs — the tabs read userProfile for display — but
  // routing no longer waits on it, since nothing gates entry on a name.
  const {
    isLoggedIn, isAuthLoading,
    setFirebaseUser, setUserProfile, setProfileHydrated,
  } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  // Listen to Firebase auth state changes
  useEffect(() => {
    const unsubscribe = auth().onAuthStateChanged(async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfileHydrated(true); // nothing to hydrate — routing may proceed
      }
      if (user) {
        // Register this device for push notifications once signed in.
        registerForPushNotifications().catch(() => { /* non-fatal */ });

        // Rehydrate the profile from backend — fixes cold-start reset bug.
        try {
          const res = await apiFetch('/api/users/me');
          if (res.ok) {
            const data = await res.json();
            // Rehydrate profile fields if present
            if (data.name || data.address || data.company || data.photo_url) {
              setUserProfile({
                name: data.name,
                phone: user.phoneNumber || '',
                email: data.email,
                address: data.address,
                company: data.company,
                role: data.role,
                photoUrl: data.photo_url,
              });
            }
          }
        } catch {
          /* non-fatal — user proceeds with local state */
        } finally {
          // Settled either way — the router can now trust userProfile.
          setProfileHydrated(true);
        }
      }
    });
    return unsubscribe;
  }, []);

  // Handle routing based on auth state
  useEffect(() => {
    if (isAuthLoading) return; // Wait for Firebase to resolve

    const inAuthGroup = (segments as string[])[0] === '(auth)';

    if (!isLoggedIn && !inAuthGroup) {
      // Require sign-in
      router.replace('/(auth)/login');
    } else if (isLoggedIn && inAuthGroup) {
      // Signed in → straight to the app. Nothing else is collected up front:
      // a display name comes from Google/Apple where available, and the
      // screens that show one fall back rather than requiring it.
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
          <Stack.Screen name="payout-method" options={{ headerShown: false }} />
          <Stack.Screen name="components/AiVoiceModal" options={{ presentation: 'modal' }} />
        </Stack>
      </AuthGuard>
    </SafeAreaProvider>
  );
}
