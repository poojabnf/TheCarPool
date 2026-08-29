import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet, StatusBar,
  KeyboardAvoidingView, Platform, Animated, Alert, ActivityIndicator, Linking, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Leaf } from 'lucide-react-native';
import HapticPressable from '../components/HapticPressable';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';
import * as haptics from '../services/haptics';
import {
  COUNTRIES, DEFAULT_COUNTRY, Country, maxDigits, isValidNsn, toE164,
} from '../services/countries';

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
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
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [pickerOpen, setPickerOpen] = useState(false);
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

  const phoneValid = isValidNsn(country, phone);

  const handleSendOtp = async () => {
    if (!phoneValid) return;
    setIsSending(true);
    try {
      const confirmation = await auth().signInWithPhoneNumber(toE164(country, phone));
      setIsSending(false);
      router.push({
        pathname: '/(auth)/otp',
        params: { phone, countryCode: country.code, verificationId: confirmation.verificationId },
      });
    } catch (error: any) {
      setIsSending(false);
      const code = error?.code ? ` [${error.code}]` : '';
      Alert.alert('Could not send OTP', (error?.message ?? 'Please check your number and try again.') + code);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      if (Platform.OS === 'android') {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }
      const response = await GoogleSignin.signIn();
      // Backing out of the account picker resolves as {type:'cancelled'} rather
      // than throwing SIGN_IN_CANCELLED (that was the pre-v13 API). Treat it as
      // what it is — the user changed their mind — and say nothing.
      if (response.type !== 'success') {
        setIsGoogleLoading(false);
        return;
      }
      const idToken = response.data?.idToken;
      if (!idToken) throw new Error('Google signed you in but returned no ID token. Please try again.');
      await auth().signInWithCredential(auth.GoogleAuthProvider.credential(idToken));
    } catch (error: any) {
      setIsGoogleLoading(false);
      Alert.alert('Google Sign-In Failed', error?.message ?? 'Please try again.');
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
      {/* Scrollable so the layout can never be squeezed shorter than its own
          content. Previously the hero was a bare flex:1 block: when the
          keyboard opened it collapsed towards zero height and, because RN
          doesn't clip overflow, the headline painted straight over the brand
          row above it. */}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        {/* Brand */}
        <View style={styles.brandRow}>
          <View style={styles.logoBox}><Leaf color="#fff" size={18} strokeWidth={2.4} /></View>
          <Text style={styles.brandName}>TheCarPool</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.h1}>Share the drive.</Text>
          <Text style={styles.h1accent}>Split the fare.</Text>
          <Text style={styles.sub}>Verified workplace carpooling for commuting professionals.</Text>
        </View>

        {/* Phone */}
        <View style={styles.phoneRow}>
          <HapticPressable
            style={styles.cc}
            onPress={() => setPickerOpen(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.ccText}>{country.flag} +{country.dial} ▾</Text>
          </HapticPressable>
          <TextInput
            style={styles.phoneInput}
            placeholder="Mobile number" placeholderTextColor={c.textDisabled}
            keyboardType="phone-pad" maxLength={maxDigits(country)} value={phone}
            onChangeText={(t) => setPhone(t.replace(/\D/g, ''))}
          />
        </View>

        <HapticPressable
          haptic="press"
          style={[styles.primaryBtn, (!phoneValid || isSending) && styles.disabled]}
          onPress={handleSendOtp} disabled={!phoneValid || isSending} activeOpacity={0.9}
        >
          {isSending ? <ActivityIndicator color={c.actionPrimaryText} /> : <Text style={styles.primaryBtnText}>Continue with OTP</Text>}
        </HapticPressable>

        <View style={styles.dividerRow}>
          <View style={styles.line} /><Text style={styles.or}>or</Text><View style={styles.line} />
        </View>

        <HapticPressable haptic="press" style={styles.socialBtn} onPress={handleGoogleSignIn} disabled={isGoogleLoading} activeOpacity={0.9}>
          {isGoogleLoading ? <ActivityIndicator color={c.textPrimary} /> : <><Text style={styles.gIcon}>G</Text><Text style={styles.socialText}>Continue with Google</Text></>}
        </HapticPressable>

        {appleAvailable && (
          <HapticPressable haptic="press" style={[styles.socialBtn, styles.appleBtn]} onPress={handleAppleSignIn} disabled={isAppleLoading} activeOpacity={0.9}>
            {isAppleLoading ? <ActivityIndicator color="#fff" /> : <><Text style={styles.appleIcon}></Text><Text style={[styles.socialText, { color: '#fff' }]}>Continue with Apple</Text></>}
          </HapticPressable>
        )}

        <Text style={styles.legal}>
          By continuing, you agree to our{' '}
          <Text style={styles.link} onPress={() => { haptics.tap(); Linking.openURL(TERMS_URL); }}>Terms</Text>
          {' '}and{' '}
          <Text style={styles.link} onPress={() => { haptics.tap(); Linking.openURL(PRIVACY_URL); }}>Privacy Policy</Text>.
        </Text>
        </Animated.View>
      </ScrollView>

      {/* Country picker. Changing country clears the number: an NSN typed for
          one country is rarely valid in another, and silently keeping it
          produces a confusing "invalid number" at the OTP step instead. */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select country</Text>
              <HapticPressable onPress={() => setPickerOpen(false)} activeOpacity={0.7}>
                <Text style={styles.modalClose}>Done</Text>
              </HapticPressable>
            </View>
            <ScrollView>
              {COUNTRIES.map((item) => (
                <HapticPressable
                  key={item.code}
                  style={[styles.countryRow, item.code === country.code && styles.countryRowActive]}
                  onPress={() => {
                    if (item.code !== country.code) setPhone('');
                    setCountry(item);
                    setPickerOpen(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.countryFlag}>{item.flag}</Text>
                  <Text style={styles.countryName}>{item.name}</Text>
                  <Text style={styles.countryDial}>+{item.dial}</Text>
                </HapticPressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  content: { flexGrow: 1, paddingHorizontal: space.xl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // minHeight is what actually prevents the overlap: flex:1 alone will happily
  // shrink to nothing when the keyboard steals the vertical space.
  hero: { flex: 1, justifyContent: 'center', minHeight: 168, paddingVertical: 24 },
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
  // Country picker
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: c.bgApp, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '75%', paddingBottom: 24 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderSubtle },
  modalTitle: { fontFamily: font.sansSemibold, fontSize: 16, color: c.textPrimary },
  modalClose: { fontFamily: font.sansSemibold, fontSize: 15, color: c.textAccent },
  countryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.xl, paddingVertical: 14 },
  countryRowActive: { backgroundColor: c.surfaceSunken },
  countryFlag: { fontSize: 22 },
  countryName: { flex: 1, fontFamily: font.sans, fontSize: 15, color: c.textPrimary },
  countryDial: { fontFamily: font.sans, fontSize: 15, color: c.textSecondary },
});
