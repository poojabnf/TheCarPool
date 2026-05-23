import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../store/authStore';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

export default function OtpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ phone: string }>();
  const phone = params.phone ?? '';
  const { login } = useAuthStore();

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');
  const [autoFilled, setAutoFilled] = useState(false);
  const inputs = useRef<(TextInput | null)[]>([]);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-fill simulation after 3s (demo)
  useEffect(() => {
    const t = setTimeout(() => {
      const demo = ['1', '2', '3', '4', '5', '6'];
      setOtp(demo);
      setAutoFilled(true);
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  // Auto-verify once all digits filled
  useEffect(() => {
    if (otp.every((d) => d !== '')) {
      handleVerify();
    }
  }, [otp]);

  const handleVerify = () => {
    const code = otp.join('');
    if (code.length < OTP_LENGTH) return;
    setIsVerifying(true);
    setError('');

    setTimeout(() => {
      // Demo: any 6-digit code works
      login(phone);
      Animated.spring(successScale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
      }).start(() => {
        router.replace('/(tabs)');
      });
    }, 1000);
  };

  const handleChange = (value: string, index: number) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    setError('');

    // Auto-advance
    if (value && index < OTP_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const handleResend = () => {
    if (countdown > 0) return;
    setOtp(Array(OTP_LENGTH).fill(''));
    setCountdown(RESEND_SECONDS);
    setError('');
    inputs.current[0]?.focus();
  };

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 80, useNativeDriver: true }),
    ]).start();
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#080c14" />

      {/* Back button */}
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backBtnText}>← Back</Text>
      </TouchableOpacity>

      {/* Success overlay */}
      <Animated.View
        style={[styles.successOverlay, { transform: [{ scale: successScale }] }]}
        pointerEvents="none"
      >
        <Text style={styles.successEmoji}>✅</Text>
        <Text style={styles.successText}>Verified!</Text>
      </Animated.View>

      <View style={styles.content}>
        {/* Header */}
        <View style={styles.iconCircle}>
          <Text style={styles.iconEmoji}>📱</Text>
        </View>
        <Text style={styles.title}>Enter OTP</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to{'\n'}
          <Text style={styles.phoneHighlight}>+91 {phone}</Text>
        </Text>

        {autoFilled && !isVerifying && (
          <View style={styles.autofillBadge}>
            <Text style={styles.autofillText}>✨ OTP auto-detected</Text>
          </View>
        )}

        {/* OTP boxes */}
        <Animated.View
          style={[styles.otpRow, { transform: [{ translateX: shakeAnim }] }]}
        >
          {Array(OTP_LENGTH)
            .fill(0)
            .map((_, i) => (
              <TextInput
                key={i}
                ref={(el) => (inputs.current[i] = el)}
                style={[
                  styles.otpBox,
                  otp[i] ? styles.otpBoxFilled : null,
                  error ? styles.otpBoxError : null,
                ]}
                value={otp[i]}
                onChangeText={(v) => handleChange(v, i)}
                onKeyPress={(e) => handleKeyPress(e, i)}
                keyboardType="number-pad"
                maxLength={1}
                selectTextOnFocus
                caretHidden
              />
            ))}
        </Animated.View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Verify button */}
        <TouchableOpacity
          style={[styles.verifyBtn, isVerifying && styles.verifyBtnLoading]}
          onPress={handleVerify}
          disabled={isVerifying || otp.some((d) => !d)}
          activeOpacity={0.8}
        >
          <Text style={styles.verifyBtnText}>
            {isVerifying ? 'Verifying…' : 'Verify & Continue →'}
          </Text>
        </TouchableOpacity>

        {/* Resend */}
        <View style={styles.resendRow}>
          <Text style={styles.resendLabel}>Didn't receive it? </Text>
          <TouchableOpacity onPress={handleResend} disabled={countdown > 0}>
            <Text style={[styles.resendLink, countdown > 0 && styles.resendLinkDisabled]}>
              {countdown > 0 ? `Resend in ${countdown}s` : 'Resend OTP'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080c14',
  },
  backBtn: {
    position: 'absolute',
    top: 56,
    left: 24,
    zIndex: 10,
  },
  backBtnText: {
    color: '#10b981',
    fontSize: 16,
    fontWeight: '600',
  },
  successOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#080c14',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  successEmoji: {
    fontSize: 72,
    marginBottom: 16,
  },
  successText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#10b981',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(16,185,129,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
  },
  iconEmoji: {
    fontSize: 32,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: '#ffffff',
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  phoneHighlight: {
    color: '#10b981',
    fontWeight: '700',
  },
  autofillBadge: {
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
  },
  autofillText: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
  },
  otpRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  otpBox: {
    width: 46,
    height: 56,
    backgroundColor: '#121b2d',
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    borderWidth: 2,
    borderColor: '#1f2d47',
  },
  otpBoxFilled: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16,185,129,0.08)',
  },
  otpBoxError: {
    borderColor: '#ef4444',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center',
  },
  verifyBtn: {
    backgroundColor: '#10b981',
    borderRadius: 14,
    paddingVertical: 17,
    paddingHorizontal: 48,
    alignItems: 'center',
    marginBottom: 20,
    width: '100%',
  },
  verifyBtnLoading: {
    opacity: 0.7,
  },
  verifyBtnText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  resendLabel: {
    color: '#6b7280',
    fontSize: 14,
  },
  resendLink: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '700',
  },
  resendLinkDisabled: {
    color: '#4b5563',
  },
});
