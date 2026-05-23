import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

GoogleSignin.configure({
  webClientId: '953521578640-rl68r8pde1odshskmaguaokjht4qbqic.apps.googleusercontent.com',
  iosClientId: '953521578640-khu8idmh7f9bmqli6pps2a2bjfmn8p9g.apps.googleusercontent.com',
});

function HeroIllustration() {
  return (
    <View style={styles.heroContainer}>
      <View style={styles.glowOrb} />
      <View style={styles.roadContainer}>
        <View style={styles.road}>
          <View style={styles.laneDash} />
          <View style={[styles.laneDash, { left: '50%' }]} />
        </View>
        <View style={[styles.car, { left: '20%', top: 10 }]}>
          <View style={styles.carBody} />
          <View style={styles.carRoof} />
          <View style={[styles.carWheel, { left: 4 }]} />
          <View style={[styles.carWheel, { right: 4 }]} />
        </View>
        <View style={[styles.car, { left: '55%', top: 35 }]}>
          <View style={[styles.carBody, { backgroundColor: '#ff6b35' }]} />
          <View style={[styles.carRoof, { backgroundColor: '#e55a2b' }]} />
          <View style={styles.carWheel} />
          <View style={[styles.carWheel, { right: 4 }]} />
        </View>
      </View>
      <View style={[styles.badge, { top: 20, left: 20 }]}>
        <Text style={styles.badgeText}>🌱 -40% CO₂</Text>
      </View>
      <View style={[styles.badge, { top: 20, right: 20, backgroundColor: 'rgba(255,107,53,0.15)' }]}>
        <Text style={[styles.badgeText, { color: '#ff6b35' }]}>💰 Save ₹8k/mo</Text>
      </View>
    </View>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  // ── Firebase Phone Auth ──────────────────────────────────────
  const handleSendOtp = async () => {
    if (phone.length < 10) return;
    setIsSending(true);
    try {
      const confirmation = await auth().signInWithPhoneNumber(`+91${phone}`);
      setIsSending(false);
      // Pass the confirmation object's verificationId to OTP screen
      router.push({
        pathname: '/(auth)/otp',
        params: { phone, verificationId: confirmation.verificationId },
      });
    } catch (error: any) {
      setIsSending(false);
      console.error('Phone auth error:', error);
      Alert.alert(
        'Could not send OTP',
        error?.message ?? 'Please check your number and try again.',
        [{ text: 'OK' }]
      );
    }
  };

  // ── Firebase Google Auth ─────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      // Get the users ID token
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const { idToken } = await GoogleSignin.signIn();

      // Create a Google credential with the token
      const googleCredential = auth.GoogleAuthProvider.credential(idToken);

      // Sign in to Firebase with the credential
      await auth().signInWithCredential(googleCredential);
      // onAuthStateChanged in _layout.tsx will handle redirect automatically
    } catch (error: any) {
      setIsGoogleLoading(false);
      console.error('Google sign-in error:', error);
      if (error?.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Google Sign-In Failed', error?.message ?? 'Please try again.');
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" backgroundColor="#080c14" />
      <View style={styles.bgGradient1} />
      <View style={styles.bgGradient2} />

      <Animated.View
        style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
      >
        {/* Brand */}
        <View style={styles.brandRow}>
          <View style={styles.logoBox}>
            <Text style={styles.logoText}>🚗</Text>
          </View>
          <Text style={styles.brandName}>TheCarPool</Text>
        </View>

        <HeroIllustration />

        <Text style={styles.tagline}>Share the Commute.</Text>
        <Text style={styles.tagline2}>Save the Planet. 🌍</Text>
        <Text style={styles.subtitle}>
          Verified workplace carpooling for Indian professionals
        </Text>

        {/* Phone input */}
        <View style={styles.phoneRow}>
          <View style={styles.countryCode}>
            <Text style={styles.countryCodeText}>🇮🇳 +91</Text>
          </View>
          <TextInput
            style={styles.phoneInput}
            placeholder="Enter mobile number"
            placeholderTextColor="#4b5563"
            keyboardType="phone-pad"
            maxLength={10}
            value={phone}
            onChangeText={setPhone}
          />
        </View>

        {/* Send OTP */}
        <TouchableOpacity
          style={[styles.primaryBtn, (phone.length < 10 || isSending) && styles.primaryBtnDisabled]}
          onPress={handleSendOtp}
          disabled={phone.length < 10 || isSending}
          activeOpacity={0.8}
        >
          {isSending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Continue with OTP →</Text>
          )}
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Google Sign-In */}
        <TouchableOpacity
          style={[styles.googleBtn, isGoogleLoading && styles.googleBtnLoading]}
          onPress={handleGoogleSignIn}
          disabled={isGoogleLoading}
          activeOpacity={0.8}
        >
          {isGoogleLoading ? (
            <ActivityIndicator color="#111827" />
          ) : (
            <>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.legal}>
          By continuing, you agree to our{' '}
          <Text style={styles.legalLink}>Terms & Conditions</Text> and{' '}
          <Text style={styles.legalLink}>Privacy Policy</Text>
        </Text>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080c14' },
  bgGradient1: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(16,185,129,0.06)', top: -50, right: -100 },
  bgGradient2: { position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,107,53,0.05)', bottom: 100, left: -80 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40, justifyContent: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  logoBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(16,185,129,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  logoText: { fontSize: 20 },
  brandName: { fontSize: 22, fontWeight: '800', color: '#ffffff', letterSpacing: -0.5 },
  heroContainer: { height: 140, marginBottom: 24, position: 'relative' },
  glowOrb: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(16,185,129,0.08)', alignSelf: 'center', top: 10 },
  roadContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },
  road: { height: 30, backgroundColor: '#1a2744', borderRadius: 4, position: 'relative', overflow: 'hidden' },
  laneDash: { position: 'absolute', width: 30, height: 3, backgroundColor: '#10b981', top: '50%', left: '25%', opacity: 0.5 },
  car: { position: 'absolute', width: 50, height: 28 },
  carBody: { position: 'absolute', bottom: 6, left: 0, right: 0, height: 16, backgroundColor: '#10b981', borderRadius: 3 },
  carRoof: { position: 'absolute', bottom: 16, left: 8, right: 8, height: 12, backgroundColor: '#0d9668', borderRadius: 4 },
  carWheel: { position: 'absolute', bottom: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: '#374151', borderWidth: 2, borderColor: '#6b7280' },
  badge: { position: 'absolute', backgroundColor: 'rgba(16,185,129,0.12)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(16,185,129,0.2)' },
  badgeText: { color: '#10b981', fontSize: 11, fontWeight: '700' },
  tagline: { fontSize: 32, fontWeight: '900', color: '#ffffff', letterSpacing: -1, lineHeight: 36 },
  tagline2: { fontSize: 28, fontWeight: '800', color: '#10b981', letterSpacing: -0.5, marginBottom: 10 },
  subtitle: { fontSize: 14, color: '#6b7280', marginBottom: 28, lineHeight: 20 },
  phoneRow: { flexDirection: 'row', marginBottom: 14, gap: 10 },
  countryCode: { backgroundColor: '#121b2d', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 16, justifyContent: 'center', borderWidth: 1, borderColor: '#1f2d47' },
  countryCodeText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  phoneInput: { flex: 1, backgroundColor: '#121b2d', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, color: '#ffffff', fontSize: 18, fontWeight: '600', borderWidth: 1, borderColor: '#1f2d47', letterSpacing: 2 },
  primaryBtn: { backgroundColor: '#10b981', borderRadius: 14, paddingVertical: 17, alignItems: 'center', marginBottom: 20 },
  primaryBtnDisabled: { backgroundColor: '#0d4f3b', opacity: 0.6 },
  primaryBtnText: { color: '#ffffff', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1f2d47' },
  dividerText: { color: '#4b5563', fontSize: 13 },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff', borderRadius: 14, paddingVertical: 16, marginBottom: 24, gap: 12 },
  googleBtnLoading: { opacity: 0.7 },
  googleIcon: { fontSize: 18, fontWeight: '900', color: '#4285F4' },
  googleBtnText: { color: '#111827', fontSize: 16, fontWeight: '600' },
  legal: { textAlign: 'center', color: '#4b5563', fontSize: 11, lineHeight: 16 },
  legalLink: { color: '#10b981', textDecorationLine: 'underline' },
});
