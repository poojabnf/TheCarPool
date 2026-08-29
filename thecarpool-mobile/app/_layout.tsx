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
import {
  registerForPushNotifications,
  subscribeToTokenRefresh,
  setupForegroundNotifications,
} from './services/notifications';
import { apiFetch } from './services/api';
import { warmUp } from './services/geo';

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

  // Wake the backend the moment the app opens. Cloud Run runs at
  // min-instances=0 to stay inside the free tier, so the first request after
  // an idle spell pays a ~9s cold start. Firing here rather than on the search
  // screen buys the container the whole of launch and sign-in to warm up,
  // instead of racing the user's first keystroke.
  useEffect(() => { warmUp(); }, []);

  // Listen to Firebase auth state changes
  useEffect(() => {
    // Held across auth changes so a sign-out/sign-in does not stack listeners.
    let unsubscribeTokenRefresh: (() => void) | undefined;
    let unsubscribeForeground: (() => void) | undefined;

    const unsubscribe = auth().onAuthStateChanged(async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfileHydrated(true); // nothing to hydrate — routing may proceed
      }
      if (user) {
        // Register this device for push notifications once signed in, and
        // keep following the token — FCM rotates it, and a stale one means
        // the user silently stops receiving anything.
        registerForPushNotifications().catch(() => { /* non-fatal */ });
        unsubscribeTokenRefresh?.();
        unsubscribeTokenRefresh = subscribeToTokenRefresh();
        unsubscribeForeground?.();
        unsubscribeForeground = setupForegroundNotifications();

        // Rehydrate the profile from backend — fixes cold-start reset bug.
        try {
          const res = await apiFetch('/api/users/me');
          if (res.ok) {
            const data = await res.json();
            // Only pass through fields the server actually returned.
            //
            // setUserProfile spreads its argument over the existing profile,
            // so passing `name: undefined` OVERWRITES a good name with
            // nothing. That is how a saved name could vanish: any response
            // carrying an address or photo but no name wiped it.
            const fields: Record<string, any> = {
              name: data.name,
              email: data.email,
              address: data.address,
              company: data.company,
              role: data.role,
              photoUrl: data.photo_url,
            };
            for (const k of Object.keys(fields)) {
              if (fields[k] === undefined || fields[k] === null) delete fields[k];
            }
            if (user.phoneNumber) fields.phone = user.phoneNumber;
            if (Object.keys(fields).length > 0) setUserProfile(fields);
          }
        } catch {
          /* non-fatal — user proceeds with local state */
        } finally {
          // Settled either way — the router can now trust userProfile.
          setProfileHydrated(true);
        }
      }
    });
    return () => {
      unsubscribe();
      unsubscribeTokenRefresh?.();
      unsubscribeForeground?.();
    };
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
