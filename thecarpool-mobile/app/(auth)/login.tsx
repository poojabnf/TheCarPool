import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar,
  KeyboardAvoidingView, Platform, Animated, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Leaf } from 'lucide-react-native';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';

// TODO: Move these to EXPO_PUBLIC_* env vars in eas.json before open-sourcing.
const GOOGLE_WEB_CLIENT_ID = '953521578640-rl68r8pde1odshskmaguaokjht4qbqic.apps.googleusercontent.com';
const GOOGLE_IOS_CLIENT_ID = '953521578640-khu8idmh7f9bmqli6pps2a2bjfmn8p9g.apps.googleusercontent.com';
const TERMS_URL = 'https://thecarpool.in/terms';
const PRIVACY_URL = 'https://thecarpool.in/privacy';

GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
  iosClientId: GOOGLE_IOS_CLIENT_ID,
});

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isAppleLoading, setIsAppleLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  React.useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
    }
  }, []);

  const handleSendOtp = async () => {
    if (phone.length < 10) return;
    setIsSending(true);
    try {
      const confirmation = await auth().signInWithPhoneNumber(`+91${phone}`);
      setIsSending(false);
      router.push({ pathname: '/(auth)/otp', params: { phone, verificationId: confirmation.verificationId } });
    } catch (error: any) {
      setIsSending(false);
      Alert.alert('Could not send OTP', error?.message ?? 'Please check your number and try again.');
    }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      const idToken = response.data?.idToken;
      if (!idToken) throw new Error('Google Sign-In was cancelled or returned no token.');
      await auth().signInWithCredential(auth.GoogleAuthProvider.credential(idToken));
    } catch (error: any) {
      setIsGoogleLoading(false);
      if (error?.code !== 'SIGN_IN_CANCELLED') Alert.alert('Google Sign-In Failed', error?.message ?? 'Please try again.');
    }
  };

  const handleAppleSignIn = async () => {
    setIsAppleLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
      if (!credential.identityToken) throw new Error('Apple Sign-In returned no identity token.');
      await auth().signInWithCredential(auth.AppleAuthProvider.credential(credential.identityToken));
    } catch (error: any) {
      setIsAppleLoading(false);
      if (error?.code !== 'ERR_REQUEST_CANCELED') Alert.alert('Apple Sign-In Failed', error?.message ?? 'Please try again.');
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" backgroundColor={c.bgApp} />
      <Animated.View style={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        {/* Brand */}
        <View style={styles.brandRow}>
          <View style={styles.logoBox}><Leaf color="#fff" size={18} strokeWidth={2.4} /></View>
          <Text style={styles.brandName}>TheCarPool</Text>
        </View>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={styles.h1}>Share the drive.</Text>
          <Text style={styles.h1accent}>Split the fare.</Text>
          <Text style={styles.sub}>Verified workplace carpooling for Indian professionals.</Text>
        </View>

        {/* Phone */}
        <View style={styles.phoneRow}>
          <View style={styles.cc}><Text style={styles.ccText}>🇮🇳 +91</Text></View>
          <TextInput
            style={styles.phoneInput}
            placeholder="Mobile number" placeholderTextColor={c.textDisabled}
            keyboardType="phone-pad" maxLength={10} value={phone} onChangeText={setPhone}
          />
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, (phone.length < 10 || isSending) && styles.disabled]}
          onPress={handleSendOtp} disabled={phone.length < 10 || isSending} activeOpacity={0.9}
        >
          {isSending ? <ActivityIndicator color={c.actionPrimaryText} /> : <Text style={styles.primaryBtnText}>Continue with OTP</Text>}
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.line} /><Text style={styles.or}>or</Text><View style={styles.line} />
        </View>

        <TouchableOpacity style={styles.socialBtn} onPress={handleGoogleSignIn} disabled={isGoogleLoading} activeOpacity={0.9}>
          {isGoogleLoading ? <ActivityIndicator color={c.textPrimary} /> : <><Text style={styles.gIcon}>G</Text><Text style={styles.socialText}>Continue with Google</Text></>}
        </TouchableOpacity>

        {appleAvailable && (
          <TouchableOpacity style={[styles.socialBtn, styles.appleBtn]} onPress={handleAppleSignIn} disabled={isAppleLoading} activeOpacity={0.9}>
            {isAppleLoading ? <ActivityIndicator color="#fff" /> : <><Text style={styles.appleIcon}></Text><Text style={[styles.socialText, { color: '#fff' }]}>Continue with Apple</Text></>}
          </TouchableOpacity>
        )}

        <Text style={styles.legal}>
          By continuing, you agree to our{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>Terms</Text>
          {' '}and{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>.
        </Text>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  content: { flex: 1, paddingHorizontal: space.xl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoBox: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: c.go, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontFamily: font.sansExtrabold, fontSize: 20, color: c.textPrimary, letterSpacing: -0.4 },

  h1: { fontFamily: font.sansExtrabold, fontSize: 38, color: c.textPrimary, letterSpacing: -1.2, lineHeight: 42 },
  h1accent: { fontFamily: font.sansExtrabold, fontSize: 38, color: c.goStrong, letterSpacing: -1.2, lineHeight: 42 },
  sub: { fontFamily: font.sans, fontSize: 15, color: c.textTertiary, marginTop: 14, lineHeight: 21 },

  phoneRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  cc: { backgroundColor: c.surfaceCard, borderRadius: radius.md, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderColor: c.borderDefault },
  ccText: { fontFamily: font.sansSemibold, fontSize: 15, color: c.textPrimary },
  phoneInput: { flex: 1, backgroundColor: c.surfaceCard, borderRadius: radius.md, paddingHorizontal: 16, height: 54, fontFamily: font.monoBold, fontSize: 17, color: c.textPrimary, borderWidth: 1, borderColor: c.borderDefault, letterSpacing: 1 },

  primaryBtn: { backgroundColor: c.actionPrimary, borderRadius: radius.md, height: 54, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  disabled: { opacity: 0.4 },
  primaryBtnText: { fontFamily: font.sansBold, fontSize: 16, color: c.actionPrimaryText },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  line: { flex: 1, height: 1, backgroundColor: c.borderSubtle },
  or: { fontFamily: font.sans, fontSize: 13, color: c.textDisabled },

  socialBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: c.surfaceCard, borderRadius: radius.md, height: 52, marginBottom: 12, borderWidth: 1, borderColor: c.borderDefault, ...shadowSm },
  gIcon: { fontFamily: font.sansExtrabold, fontSize: 17, color: '#4285F4' },
  socialText: { fontFamily: font.sansBold, fontSize: 15, color: c.textPrimary },
  appleBtn: { backgroundColor: c.textPrimary, borderColor: c.textPrimary },
  appleIcon: { fontSize: 17, color: '#fff', marginTop: -2 },

  legal: { fontFamily: font.sans, textAlign: 'center', color: c.textDisabled, fontSize: 11.5, lineHeight: 16, marginTop: 8 },
  link: { color: c.textAccent, fontFamily: font.sansSemibold },
});
