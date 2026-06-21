import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar, Animated } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import { c, font, radius, space } from '../../theme/tokens';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

export default function OtpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ phone: string; verificationId: string }>();
  const phone = params.phone ?? '';
  const [verificationId, setVerificationId] = useState(params.verificationId ?? '');

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');
  const inputs = useRef<(TextInput | null)[]>([]);
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (otp.every((d) => d !== '')) handleVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length < OTP_LENGTH) return;
    setIsVerifying(true);
    setError('');
    try {
      await auth().signInWithCredential(auth.PhoneAuthProvider.credential(verificationId, code));
      // _layout AuthGuard redirects on success.
    } catch {
      setError('Invalid code. Please try again.');
      setIsVerifying(false);
      setOtp(Array(OTP_LENGTH).fill(''));
      inputs.current[0]?.focus();
      Animated.sequence([
        Animated.timing(shake, { toValue: 8, duration: 70, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -8, duration: 70, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 70, useNativeDriver: true }),
      ]).start();
    }
  };

  const handleChange = (value: string, i: number) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[i] = value.slice(-1);
    setOtp(next);
    setError('');
    if (value && i < OTP_LENGTH - 1) inputs.current[i + 1]?.focus();
  };

  const handleKey = (e: any, i: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setOtp(Array(OTP_LENGTH).fill(''));
    setError('');
    inputs.current[0]?.focus();
    try {
      const confirmation = await auth().signInWithPhoneNumber(`+91${phone}`);
      setVerificationId(confirmation.verificationId ?? '');
      setCountdown(RESEND_SECONDS);
    } catch (err: any) {
      setError(err?.message ?? 'Could not resend OTP.');
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <StatusBar barStyle="dark-content" backgroundColor={c.bgApp} />
      <TouchableOpacity style={styles.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/login'))}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.body}>
        <Text style={styles.h1}>Enter the code</Text>
        <Text style={styles.sub}>We sent a 6-digit code to{'\n'}<Text style={styles.phone}>+91 {phone}</Text></Text>

        <Animated.View style={[styles.otpRow, { transform: [{ translateX: shake }] }]}>
          {Array(OTP_LENGTH).fill(0).map((_, i) => (
            <TextInput
              key={i}
              ref={(el) => { inputs.current[i] = el; }}
              style={[styles.box, otp[i] ? styles.boxFilled : null, error ? styles.boxError : null]}
              value={otp[i]}
              onChangeText={(v) => handleChange(v, i)}
              onKeyPress={(e) => handleKey(e, i)}
              keyboardType="number-pad" maxLength={1} selectTextOnFocus caretHidden
            />
          ))}
        </Animated.View>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.verifyBtn, (isVerifying || otp.some((d) => !d)) && styles.disabled]}
          onPress={handleVerify} disabled={isVerifying || otp.some((d) => !d)} activeOpacity={0.9}
        >
          <Text style={styles.verifyText}>{isVerifying ? 'Verifying…' : 'Verify & continue'}</Text>
        </TouchableOpacity>

        <View style={styles.resendRow}>
          <Text style={styles.resendLabel}>Didn't get it? </Text>
          <TouchableOpacity onPress={handleResend} disabled={countdown > 0}>
            <Text style={[styles.resendLink, countdown > 0 && styles.resendDisabled]}>
              {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp, paddingHorizontal: space.xl },
  back: { paddingVertical: 8 },
  backText: { fontFamily: font.sansSemibold, fontSize: 15, color: c.textSecondary },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 60 },
  h1: { fontFamily: font.sansExtrabold, fontSize: 28, color: c.textPrimary, letterSpacing: -0.6 },
  sub: { fontFamily: font.sans, fontSize: 14.5, color: c.textTertiary, textAlign: 'center', lineHeight: 22, marginTop: 8, marginBottom: 28 },
  phone: { fontFamily: font.monoBold, color: c.textPrimary },
  otpRow: { flexDirection: 'row', gap: 10 },
  box: { width: 46, height: 56, backgroundColor: c.surfaceCard, borderRadius: radius.md, textAlign: 'center', fontFamily: font.monoBold, fontSize: 22, color: c.textPrimary, borderWidth: 1.5, borderColor: c.borderDefault },
  boxFilled: { borderColor: c.textPrimary },
  boxError: { borderColor: c.danger },
  error: { fontFamily: font.sansMedium, color: c.danger, fontSize: 13, marginTop: 14 },
  verifyBtn: { backgroundColor: c.actionPrimary, borderRadius: radius.md, height: 52, paddingHorizontal: 40, alignItems: 'center', justifyContent: 'center', marginTop: 28, alignSelf: 'stretch' },
  disabled: { opacity: 0.4 },
  verifyText: { fontFamily: font.sansBold, fontSize: 16, color: c.actionPrimaryText },
  resendRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20 },
  resendLabel: { fontFamily: font.sans, fontSize: 14, color: c.textTertiary },
  resendLink: { fontFamily: font.sansBold, fontSize: 14, color: c.textAccent },
  resendDisabled: { color: c.textDisabled },
});
