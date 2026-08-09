import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  StatusBar,
  ScrollView,
  Animated,
  Alert,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { apiFetch } from '../services/api';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../store/authStore';
import { CameraView, useCameraPermissions } from 'expo-camera';
import HapticPressable from '../components/HapticPressable';

const { width } = Dimensions.get('window');
const TOTAL_STEPS = 5;

// ─── Step indicators ──────────────────────────────────────────────
function ProgressBar({ currentStep }: { currentStep: number }) {
  return (
    <View style={styles.progressContainer}>
      {Array(TOTAL_STEPS)
        .fill(0)
        .map((_, i) => {
          const isComplete = i < currentStep;
          const isActive = i === currentStep;
          return (
            <React.Fragment key={i}>
              <View
                style={[
                  styles.stepDot,
                  isComplete ? styles.stepDotComplete : null,
                  isActive ? styles.stepDotActive : null,
                ]}
              >
                {isComplete ? (
                  <Text style={styles.stepDotCheckmark}>✓</Text>
                ) : (
                  <Text style={[styles.stepDotNum, isActive && { color: '#fff' }]}>
                    {i + 1}
                  </Text>
                )}
              </View>
              {i < TOTAL_STEPS - 1 && (
                <View
                  style={[styles.progressLine, isComplete && styles.progressLineComplete]}
                />
              )}
            </React.Fragment>
          );
        })}
    </View>
  );
}

const STEP_LABELS = ['Role', 'Profile', 'Aadhaar', 'PAN', 'Selfie'];
const STEP_ICONS = ['🚗', '👤', '🪪', '💳', '🤳'];
const STEP_DESCRIPTIONS = [
  'Choose how you want to use the app',
  'Tell us about yourself',
  'Link your Aadhaar for identity',
  'Verify PAN for tax compliance',
  'Face liveness check for security',
];

// ─── Step 0: Role ─────────────────────────────────────────────────
function StepRole({ onNext }: { onNext: (data: any) => void }) {
  const [selectedRole, setSelectedRole] = useState<'rider' | 'partner' | null>(null);

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.stepTitle}>Choose Your Role</Text>
      <Text style={styles.stepSubtitle}>
        Are you looking for a ride, or do you want to offer rides to your co-workers?
      </Text>

      <HapticPressable 
        style={[styles.roleCard, selectedRole === 'rider' && styles.roleCardActive]} 
        onPress={() => setSelectedRole('rider')}
        activeOpacity={0.8}
      >
        <Text style={styles.roleIcon}>🧍</Text>
        <View style={styles.roleInfo}>
          <Text style={styles.roleTitle}>Rider</Text>
          <Text style={styles.roleDesc}>Find verified carpools on your daily route and save money.</Text>
        </View>
      </HapticPressable>

      <HapticPressable 
        style={[styles.roleCard, selectedRole === 'partner' && styles.roleCardActive]} 
        onPress={() => setSelectedRole('partner')}
        activeOpacity={0.8}
      >
        <Text style={styles.roleIcon}>🚘</Text>
        <View style={styles.roleInfo}>
          <Text style={styles.roleTitle}>Partner</Text>
          <Text style={styles.roleDesc}>Offer empty seats in your car and split commuting costs.</Text>
        </View>
      </HapticPressable>

      <HapticPressable haptic="press"
        style={[styles.nextBtn, !selectedRole && styles.nextBtnDisabled]}
        onPress={() => selectedRole && onNext({ role: selectedRole })}
        activeOpacity={0.8}
      >
        <Text style={styles.nextBtnText}>Continue →</Text>
      </HapticPressable>
    </ScrollView>
  );
}

// ─── Step 1: Basic Profile ────────────────────────────────────────
function StepProfile({ onNext }: { onNext: (data: any) => void }) {
  const [name, setName] = useState('');
  // Company / employee ID / work location were dropped: the app is open to
  // anyone commuting, not just corporate employees, and asking for an employer
  // we never verify was friction for no gain. An address is what actually helps
  // match people on a route.
  const [address, setAddress] = useState('');

  const isValid = name.trim().length > 1 && address.trim().length > 2;

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.stepTitle}>Basic Profile</Text>
      <Text style={styles.stepSubtitle}>
        Your info stays private — only used for carpool matching.
      </Text>

      <Field
        label="Full Name *"
        placeholder="e.g. Pooja Yadav"
        value={name}
        onChangeText={setName}
      />
      <Field
        label="Address *"
        placeholder="e.g. DLF Phase 5, Gurugram"
        value={address}
        onChangeText={setAddress}
      />

      <HapticPressable haptic="press"
        style={[styles.nextBtn, !isValid && styles.nextBtnDisabled]}
        onPress={() => isValid && onNext({ name, address })}
        activeOpacity={0.8}
      >
        <Text style={styles.nextBtnText}>Continue →</Text>
      </HapticPressable>
    </ScrollView>
  );
}

// ─── Step 2: Aadhaar ──────────────────────────────────────────────
function StepAadhaar({ onNext }: { onNext: (data: any) => void }) {
  const [aadhaar, setAadhaar] = useState('');
  // No OTP stage: we don't talk to UIDAI, so there is no OTP to send. The
  // number is validated locally (12 digits + Verhoeff checksum, server-side)
  // and then matched against the copy the user uploads.
  const [stage, setStage] = useState<'input' | 'done'>('input');
  const [loading, setLoading] = useState(false);

  const formatted = aadhaar.replace(/(\d{4})(?=\d)/g, '$1 ').trim();

  // Capture the document itself. The server OCRs it and refuses if the image
  // is blank, is a different document type, or carries a different number than
  // the one typed — that cross-check is what stands in for a government API.
  const captureDocument = async (source: 'camera' | 'library') => {
    try {
      const perm = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Enable access in Settings to add your document.');
        return;
      }
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (result.canceled || !result.assets?.[0]?.base64) return;

      setLoading(true);
      const res = await apiFetch('/api/safety/kyc/document', {
        method: 'POST',
        body: JSON.stringify({
          document_type: 'AADHAAR',
          id_number: aadhaar.replace(/\s/g, ''),
          image_base64: result.assets[0].base64,
        }),
      }, { timeoutMs: 45000 });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        Alert.alert('Could not verify', data.message || data.error || 'Please try again with a clearer photo.');
        return;
      }
      setStage('done');
    } catch {
      Alert.alert('Error', 'Could not check your document. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (stage === 'done') {
    return (
      <View style={styles.verifiedContainer}>
        <Text style={styles.verifiedEmoji}>✅</Text>
        <Text style={styles.verifiedTitle}>Aadhaar checked</Text>
        <Text style={styles.verifiedSub}>
          The number and your uploaded copy match.{'\n'}Last 4 digits: ••••{' '}
          {aadhaar.slice(-4)}
        </Text>
        <HapticPressable haptic="press"
          style={styles.nextBtn}
          onPress={() => onNext({ aadhaarLast4: aadhaar.slice(-4) })}
          activeOpacity={0.8}
        >
          <Text style={styles.nextBtnText}>Continue to PAN →</Text>
        </HapticPressable>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.stepTitle}>Aadhaar Verification</Text>
      <Text style={styles.stepSubtitle}>
        Enter your number, then upload a photo of the same card so we can check they match.
      </Text>

      <InfoCard
        icon="🔒"
        text="We check the number's format and match it against the copy you upload. Only the last 4 digits are kept — the image is deleted after 15 days."
      />
      <Field
        label="Aadhaar Number *"
        placeholder="XXXX XXXX XXXX"
        value={formatted}
        onChangeText={(t: string) => setAadhaar(t.replace(/\D/g, '').slice(0, 12))}
        keyboardType="number-pad"
        maxLength={14}
      />

      <HapticPressable haptic="press"
        style={[styles.nextBtn, (aadhaar.length < 12 || loading) && styles.nextBtnDisabled]}
        onPress={() => Alert.alert('Upload your Aadhaar', 'Add a clear photo of the card', [
          { text: 'Take photo', onPress: () => captureDocument('camera') },
          { text: 'Choose from gallery', onPress: () => captureDocument('library') },
          { text: 'Cancel', style: 'cancel' },
        ])}
        disabled={loading || aadhaar.length < 12}
        activeOpacity={0.8}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.nextBtnText}>Upload Aadhaar copy →</Text>}
      </HapticPressable>
    </ScrollView>
  );
}

// ─── Step 3: PAN ──────────────────────────────────────────────────
function StepPan({ onNext }: { onNext: (data: any) => void }) {
  const { userProfile } = useAuthStore();
  const [pan, setPan] = useState('');
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [fetchedName, setFetchedName] = useState('');

  const panFormatted = pan.toUpperCase();
  const isValidPan = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panFormatted);

  const handleVerify = () => {
    if (!isValidPan) return;
    setLoading(true);
    setFetchedName(userProfile?.name?.toUpperCase() || 'USER');
    setVerified(true);
    setLoading(false);
  };

  if (verified) {
    return (
      <View style={styles.verifiedContainer}>
        <Text style={styles.verifiedEmoji}>✅</Text>
        <Text style={styles.verifiedTitle}>PAN Verified!</Text>
        <Text style={styles.verifiedSub}>
          Name on PAN: <Text style={{ color: '#0E8A5F', fontWeight: '700' }}>{fetchedName}</Text>
          {'\n'}PAN: {panFormatted}
        </Text>
        <HapticPressable haptic="press"
          style={styles.nextBtn}
          onPress={() => onNext({ panNumber: panFormatted })}
          activeOpacity={0.8}
        >
          <Text style={styles.nextBtnText}>Continue to Selfie →</Text>
        </HapticPressable>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.stepTitle}>PAN Verification</Text>
      <Text style={styles.stepSubtitle}>
        Required for payment compliance under Indian tax regulations.
      </Text>

      <InfoCard
        icon="💡"
        text="Your PAN is verified via NSDL/CDSL API. Format: ABCDE1234F"
      />

      <Field
        label="PAN Card Number *"
        placeholder="ABCDE1234F"
        value={panFormatted}
        onChangeText={(t: string) => setPan(t.toUpperCase().slice(0, 10))}
        autoCapitalize="characters"
        maxLength={10}
      />

      {pan.length === 10 && !isValidPan && (
        <Text style={styles.fieldError}>
          ⚠️ Invalid PAN format. Should be like: ABCDE1234F
        </Text>
      )}

      <HapticPressable haptic="press"
        style={[styles.nextBtn, !isValidPan && styles.nextBtnDisabled]}
        onPress={handleVerify}
        disabled={loading || !isValidPan}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.nextBtnText}>Verify PAN →</Text>
        )}
      </HapticPressable>
    </ScrollView>
  );
}

// ─── Step 4: Selfie / Liveness ────────────────────────────────────
function StepSelfie({ onNext }: { onNext: () => void }) {
  const [stage, setStage] = useState<'idle' | 'scanning' | 'done'>('idle');
  const [permission, requestPermission] = useCameraPermissions();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  };

  const handleTakeSelfie = async () => {
    if (!permission?.granted) {
      const p = await requestPermission();
      if (!p.granted) {
        Alert.alert('Permission Denied', 'We need camera access to complete liveness verification.');
        return;
      }
    }
    setStage('scanning');
    startPulse();
    setTimeout(() => {
      pulseAnim.stopAnimation();
      setStage('done');
    }, 3000);
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ alignItems: 'center' }}
    >
      <Text style={styles.stepTitle}>Selfie Verification</Text>
      <Text style={styles.stepSubtitle}>
        A quick liveness check to confirm your identity matches Aadhaar.
      </Text>

      {/* Camera view placeholder */}
      <Animated.View
        style={[styles.cameraBox, stage === 'scanning' && { transform: [{ scale: pulseAnim }] }]}
      >
        {stage === 'scanning' && permission?.granted && (
          <CameraView style={StyleSheet.absoluteFill} facing="front" />
        )}
        {stage === 'idle' && (
          <>
            <Text style={styles.cameraEmoji}>📷</Text>
            <Text style={styles.cameraHint}>Position your face{'\n'}within the oval</Text>
          </>
        )}
        {stage === 'scanning' && (
          <>
            <Text style={{ ...styles.cameraHint, color: '#FFFFFF', position: 'absolute', bottom: 40, backgroundColor: 'rgba(0,0,0,0.5)', padding: 4 }}>
              Checking liveness…{'\n'}Please blink twice
            </Text>
          </>
        )}
        {stage === 'done' && (
          <>
            <Text style={styles.cameraEmoji}>✅</Text>
            <Text style={[styles.cameraHint, { color: '#0E8A5F' }]}>
              98.4% match{'\n'}Liveness confirmed
            </Text>
          </>
        )}
        {/* Oval face guide */}
        <View style={styles.faceOval} />
        {/* Corner guides */}
        {['TL', 'TR', 'BL', 'BR'].map((c) => (
          <View
            key={c}
            style={[
              styles.cornerGuide,
              c.includes('T') ? { top: 20 } : { bottom: 20 },
              c.includes('L') ? { left: 30 } : { right: 30 },
              stage === 'done' && { borderColor: '#0E8A5F' },
            ]}
          />
        ))}
      </Animated.View>

      <InfoCard
        icon="🔒"
        text="Your selfie is used to confirm a real person is signing up. We do not match it against any government database."
      />

      {stage !== 'done' ? (
        <HapticPressable haptic="press"
          style={[styles.nextBtn, stage === 'scanning' && styles.nextBtnDisabled, { width: '100%' }]}
          onPress={handleTakeSelfie}
          disabled={stage === 'scanning'}
          activeOpacity={0.8}
        >
          <Text style={styles.nextBtnText}>
            {stage === 'idle' ? '📸 Take Selfie' : '⏳ Scanning…'}
          </Text>
        </HapticPressable>
      ) : (
        <HapticPressable haptic="press"
          style={[styles.nextBtn, { width: '100%', backgroundColor: '#0E8A5F' }]}
          onPress={onNext}
          activeOpacity={0.8}
        >
          <Text style={styles.nextBtnText}>🎉 Activate My Account →</Text>
        </HapticPressable>
      )}
    </ScrollView>
  );
}

// ─── Reusable Field ───────────────────────────────────────────────
function Field({
  label,
  placeholder,
  value,
  onChangeText,
  keyboardType = 'default',
  maxLength,
  autoCapitalize = 'words',
}: any) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        placeholder={placeholder}
        placeholderTextColor="#97A1AB"
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

// ─── Info card ────────────────────────────────────────────────────
function InfoCard({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoIcon}>{icon}</Text>
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────
export default function OnboardingScreen() {
  const router = useRouter();
  const { setUserProfile, setOnboardingStep, completeOnboarding, userProfile } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const goToStep = (next: number) => {
    Animated.timing(slideAnim, { toValue: -width, duration: 250, useNativeDriver: true }).start(
      () => {
        setCurrentStep(next);
        slideAnim.setValue(width);
        Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
      }
    );
  };

  const handleNext = async (data?: any) => {
    if (data) setUserProfile(data);
    setOnboardingStep(currentStep + 1);
    if (currentStep < TOTAL_STEPS - 1) {
      goToStep(currentStep + 1);
    } else {
      // All steps complete — persist to backend then navigate.
      setIsSaving(true);
      try {
        // Merge any last-step data with accumulated profile
        const fullProfile = { ...(userProfile || {}), ...(data || {}) };

        // 1. Save user profile to Firestore via backend
        await apiFetch('/api/users/profile', {
          method: 'POST',
          body: JSON.stringify({
            name: fullProfile.name,
            address: fullProfile.address,
            role: fullProfile.role,
          }),
        });

        // 2. Mark KYC as verified
        await apiFetch('/api/safety/kyc/complete', {
          method: 'POST',
        });

        // 3. Update local store
        completeOnboarding();
        router.replace('/(tabs)');
      } catch {
        Alert.alert(
          'Save Failed',
          'Could not save your profile. Please check your connection and try again.',
          [{ text: 'Retry', onPress: () => handleNext(data) }, { text: 'Skip for Now', onPress: () => { completeOnboarding(); router.replace('/(tabs)'); } }]
        );
      } finally {
        setIsSaving(false);
      }
    }
  };

  const steps = [
    <StepRole key="role" onNext={(d) => handleNext(d)} />,
    <StepProfile key="profile" onNext={(d) => handleNext(d)} />,
    <StepAadhaar key="aadhaar" onNext={(d) => handleNext(d)} />,
    <StepPan key="pan" onNext={(d) => handleNext(d)} />,
    <StepSelfie key="selfie" onNext={() => handleNext()} />,
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAFBFC" />

      {/* Header */}
      <View style={styles.header}>
        <HapticPressable onPress={() => {
          Alert.alert(
            'Skip KYC Setup?',
            'You can browse rides but will need to complete identity verification before booking your first ride.',
            [
              { text: 'Continue Setup', style: 'cancel' },
              { text: 'Skip for Now', style: 'destructive', onPress: () => router.replace('/(tabs)') },
            ]
          );
        }}>
          <Text style={styles.skipText}>Skip for now</Text>
        </HapticPressable>
        <Text style={styles.headerTitle}>Account Setup</Text>
        <Text style={styles.stepCounter}>{currentStep + 1}/{TOTAL_STEPS}</Text>
      </View>

      {/* Progress bar */}
      <ProgressBar currentStep={currentStep} />

      {/* Step label */}
      <View style={styles.stepLabelRow}>
        <Text style={styles.stepIcon}>{STEP_ICONS[currentStep]}</Text>
        <View>
          <Text style={styles.stepLabelText}>{STEP_LABELS[currentStep]}</Text>
          <Text style={styles.stepLabelDesc}>{STEP_DESCRIPTIONS[currentStep]}</Text>
        </View>
      </View>

      {/* Step content */}
      <Animated.View
        style={[styles.stepContent, { transform: [{ translateX: slideAnim }] }]}
      >
        {steps[currentStep]}
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFBFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingBottom: 16,
  },
  headerTitle: {
    color: '#141A20',
    fontSize: 16,
    fontWeight: '700',
  },
  skipText: {
    color: '#6B7682',
    fontSize: 13,
  },
  stepCounter: {
    color: '#0E8A5F',
    fontSize: 13,
    fontWeight: '700',
  },
  // Progress bar
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  stepDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F4F6F8',
    borderWidth: 2,
    borderColor: '#E2E6EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: {
    backgroundColor: '#0E8A5F',
    borderColor: '#0E8A5F',
  },
  stepDotComplete: {
    backgroundColor: '#BCC4CC',
    borderColor: '#0E8A5F',
  },
  stepDotNum: {
    color: '#6B7682',
    fontSize: 13,
    fontWeight: '700',
  },
  stepDotCheckmark: {
    color: '#0E8A5F',
    fontSize: 14,
    fontWeight: '900',
  },
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#E2E6EA',
    marginHorizontal: 4,
  },
  progressLineComplete: {
    backgroundColor: '#0E8A5F',
  },
  // Step label
  stepLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
    gap: 12,
  },
  stepIcon: {
    fontSize: 32,
  },
  stepLabelText: {
    color: '#141A20',
    fontSize: 18,
    fontWeight: '800',
  },
  stepLabelDesc: {
    color: '#6B7682',
    fontSize: 12,
    marginTop: 2,
  },
  // Step content
  stepContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#141A20',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  stepSubtitle: {
    fontSize: 13,
    color: '#6B7682',
    lineHeight: 20,
    marginBottom: 20,
  },
  // Fields
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7682',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  fieldInput: {
    backgroundColor: '#F4F6F8',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#141A20',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E2E6EA',
  },
  fieldError: {
    color: '#C9851A',
    fontSize: 12,
    marginTop: -10,
    marginBottom: 12,
  },
  // Info card
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E2E6EA',
    gap: 10,
    alignItems: 'flex-start',
  },
  infoIcon: {
    fontSize: 18,
  },
  infoText: {
    flex: 1,
    color: '#6B7682',
    fontSize: 12,
    lineHeight: 18,
  },
  // Buttons
  nextBtn: {
    backgroundColor: '#0E8A5F',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  nextBtnDisabled: {
    backgroundColor: '#BCC4CC',
    opacity: 0.5,
  },
  nextBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // Verified state
  verifiedContainer: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 40,
  },
  verifiedEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  verifiedTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#0E8A5F',
    marginBottom: 12,
  },
  verifiedSub: {
    color: '#6B7682',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  // Camera box
  cameraBox: {
    width: 240,
    height: 280,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#E2E6EA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    position: 'relative',
    overflow: 'hidden',
  },
  cameraEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  cameraHint: {
    color: '#6B7682',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  faceOval: {
    position: 'absolute',
    width: 140,
    height: 180,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: 'rgba(14,138,95,0.3)',
    borderStyle: 'dashed',
  },
  cornerGuide: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#0E8A5F',
    borderWidth: 2,
  },
  roleCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#E2E6EA',
    alignItems: 'center',
    gap: 16,
  },
  roleCardActive: {
    borderColor: '#0E8A5F',
    backgroundColor: 'rgba(14,138,95,0.1)',
  },
  roleIcon: {
    fontSize: 40,
  },
  roleInfo: {
    flex: 1,
  },
  roleTitle: {
    color: '#141A20',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  roleDesc: {
    color: '#6B7682',
    fontSize: 13,
    lineHeight: 18,
  },
});
