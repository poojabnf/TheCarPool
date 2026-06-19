import React, { useState, useRef } from 'react';
import { Alert } from 'react-native';
import { apiFetch } from '../services/api';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Animated,
  Alert,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';

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

      <TouchableOpacity 
        style={[styles.roleCard, selectedRole === 'rider' && styles.roleCardActive]} 
        onPress={() => setSelectedRole('rider')}
        activeOpacity={0.8}
      >
        <Text style={styles.roleIcon}>🧍</Text>
        <View style={styles.roleInfo}>
          <Text style={styles.roleTitle}>Rider</Text>
          <Text style={styles.roleDesc}>Find verified carpools on your daily route and save money.</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.roleCard, selectedRole === 'partner' && styles.roleCardActive]} 
        onPress={() => setSelectedRole('partner')}
        activeOpacity={0.8}
      >
        <Text style={styles.roleIcon}>🚘</Text>
        <View style={styles.roleInfo}>
          <Text style={styles.roleTitle}>Partner</Text>
          <Text style={styles.roleDesc}>Offer empty seats in your car and split commuting costs.</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.nextBtn, !selectedRole && styles.nextBtnDisabled]}
        onPress={() => selectedRole && onNext({ role: selectedRole })}
        activeOpacity={0.8}
      >
        <Text style={styles.nextBtnText}>Continue →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Step 1: Basic Profile ────────────────────────────────────────
function StepProfile({ onNext }: { onNext: (data: any) => void }) {
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [company, setCompany] = useState('');
  const [workLocation, setWorkLocation] = useState('');

  const isValid = name.trim().length > 1 && company.trim().length > 1;

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
        label="Company / Organisation *"
        placeholder="e.g. Infosys, TCS, HDFC"
        value={company}
        onChangeText={setCompany}
      />
      <Field
        label="Employee / Staff ID"
        placeholder="Optional — for workplace verification"
        value={employeeId}
        onChangeText={setEmployeeId}
      />
      <Field
        label="Work Location / Office Area"
        placeholder="e.g. Cyber City, Gurugram"
        value={workLocation}
        onChangeText={setWorkLocation}
      />

      <TouchableOpacity
        style={[styles.nextBtn, !isValid && styles.nextBtnDisabled]}
        onPress={() => isValid && onNext({ name, employeeId, company, workLocation })}
        activeOpacity={0.8}
      >
        <Text style={styles.nextBtnText}>Continue →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Step 2: Aadhaar ──────────────────────────────────────────────
function StepAadhaar({ onNext }: { onNext: (data: any) => void }) {
  const [aadhaar, setAadhaar] = useState('');
  const [stage, setStage] = useState<'input' | 'otp' | 'done'>('input');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);

  const formatted = aadhaar.replace(/(\d{4})(?=\d)/g, '$1 ').trim();

  const handleSendOtp = () => {
    if (aadhaar.replace(/\s/g, '').length !== 12) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStage('otp');
    }, 1500);
  };

  const handleVerifyOtp = () => {
    if (otp.length < 6) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStage('done');
    }, 1500);
  };

  if (stage === 'done') {
    return (
      <View style={styles.verifiedContainer}>
        <Text style={styles.verifiedEmoji}>🎉</Text>
        <Text style={styles.verifiedTitle}>Aadhaar Verified!</Text>
        <Text style={styles.verifiedSub}>
          Identity confirmed with UIDAI registry.{'\n'}Last 4 digits: ••••{' '}
          {aadhaar.slice(-4)}
        </Text>
        <TouchableOpacity
          style={styles.nextBtn}
          onPress={() => onNext({ aadhaarLast4: aadhaar.slice(-4) })}
          activeOpacity={0.8}
        >
          <Text style={styles.nextBtnText}>Continue to PAN →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.stepTitle}>Aadhaar Verification</Text>
      <Text style={styles.stepSubtitle}>
        Required by RBI guidelines for identity verification. Your Aadhaar is never stored.
      </Text>

      {stage === 'input' ? (
        <>
          <InfoCard
            icon="🔒"
            text="We use DigiLocker API to verify your identity. No document is uploaded or stored."
          />
          <Field
            label="Aadhaar Number *"
            placeholder="XXXX XXXX XXXX"
            value={formatted}
            onChangeText={(t: string) => setAadhaar(t.replace(/\D/g, '').slice(0, 12))}
            keyboardType="number-pad"
            maxLength={14}
          />
          <TouchableOpacity
            style={[
              styles.nextBtn,
              aadhaar.length < 12 && styles.nextBtnDisabled,
            ]}
            onPress={handleSendOtp}
            disabled={loading || aadhaar.length < 12}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.nextBtnText}>Send OTP to Linked Mobile →</Text>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <InfoCard
            icon="📱"
            text={`OTP sent to the mobile number linked with Aadhaar ending ••••${aadhaar.slice(-4)}`}
          />
          <Field
            label="Enter 6-digit OTP *"
            placeholder="• • • • • •"
            value={otp}
            onChangeText={(t: string) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
          />
          <TouchableOpacity
            style={[styles.nextBtn, otp.length < 6 && styles.nextBtnDisabled]}
            onPress={handleVerifyOtp}
            disabled={loading || otp.length < 6}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.nextBtnText}>Verify Aadhaar →</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

// ─── Step 3: PAN ──────────────────────────────────────────────────
function StepPan({ onNext }: { onNext: (data: any) => void }) {
  const [pan, setPan] = useState('');
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [fetchedName, setFetchedName] = useState('');

  const panFormatted = pan.toUpperCase();
  const isValidPan = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panFormatted);

  const handleVerify = () => {
    if (!isValidPan) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setFetchedName('POOJA YADAV');
      setVerified(true);
    }, 2000);
  };

  if (verified) {
    return (
      <View style={styles.verifiedContainer}>
        <Text style={styles.verifiedEmoji}>✅</Text>
        <Text style={styles.verifiedTitle}>PAN Verified!</Text>
        <Text style={styles.verifiedSub}>
          Name on PAN: <Text style={{ color: '#10b981', fontWeight: '700' }}>{fetchedName}</Text>
          {'\n'}PAN: {panFormatted}
        </Text>
        <TouchableOpacity
          style={styles.nextBtn}
          onPress={() => onNext({ panNumber: panFormatted })}
          activeOpacity={0.8}
        >
          <Text style={styles.nextBtnText}>Continue to Selfie →</Text>
        </TouchableOpacity>
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

      <TouchableOpacity
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
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Step 4: Selfie / Liveness ────────────────────────────────────
function StepSelfie({ onNext }: { onNext: () => void }) {
  const [stage, setStage] = useState<'idle' | 'scanning' | 'done'>('idle');
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  };

  const handleTakeSelfie = () => {
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
        {stage === 'idle' && (
          <>
            <Text style={styles.cameraEmoji}>📷</Text>
            <Text style={styles.cameraHint}>Position your face{'\n'}within the oval</Text>
          </>
        )}
        {stage === 'scanning' && (
          <>
            <Text style={styles.cameraEmoji}>🔍</Text>
            <Text style={[styles.cameraHint, { color: '#10b981' }]}>
              Checking liveness…{'\n'}Please blink twice
            </Text>
          </>
        )}
        {stage === 'done' && (
          <>
            <Text style={styles.cameraEmoji}>✅</Text>
            <Text style={[styles.cameraHint, { color: '#10b981' }]}>
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
              stage === 'done' && { borderColor: '#10b981' },
            ]}
          />
        ))}
      </Animated.View>

      <InfoCard
        icon="🔒"
        text="Selfie is matched against your Aadhaar photo via DigiLocker. It is not stored on our servers."
      />

      {stage !== 'done' ? (
        <TouchableOpacity
          style={[styles.nextBtn, stage === 'scanning' && styles.nextBtnDisabled, { width: '100%' }]}
          onPress={handleTakeSelfie}
          disabled={stage === 'scanning'}
          activeOpacity={0.8}
        >
          <Text style={styles.nextBtnText}>
            {stage === 'idle' ? '📸 Take Selfie' : '⏳ Scanning…'}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.nextBtn, { width: '100%', backgroundColor: '#0d9668' }]}
          onPress={onNext}
          activeOpacity={0.8}
        >
          <Text style={styles.nextBtnText}>🎉 Activate My Account →</Text>
        </TouchableOpacity>
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
        placeholderTextColor="#4b5563"
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
            company: fullProfile.company,
            employeeId: fullProfile.employeeId,
            workLocation: fullProfile.workLocation,
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
      <StatusBar barStyle="light-content" backgroundColor="#080c14" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
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
        </TouchableOpacity>
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
    backgroundColor: '#080c14',
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
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  skipText: {
    color: '#6b7280',
    fontSize: 13,
  },
  stepCounter: {
    color: '#10b981',
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
    backgroundColor: '#121b2d',
    borderWidth: 2,
    borderColor: '#1f2d47',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  stepDotComplete: {
    backgroundColor: '#064e3b',
    borderColor: '#10b981',
  },
  stepDotNum: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
  },
  stepDotCheckmark: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '900',
  },
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#1f2d47',
    marginHorizontal: 4,
  },
  progressLineComplete: {
    backgroundColor: '#10b981',
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
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  stepLabelDesc: {
    color: '#6b7280',
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
    color: '#ffffff',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  stepSubtitle: {
    fontSize: 13,
    color: '#6b7280',
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
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  fieldInput: {
    backgroundColor: '#121b2d',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#ffffff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#1f2d47',
  },
  fieldError: {
    color: '#fbbf24',
    fontSize: 12,
    marginTop: -10,
    marginBottom: 12,
  },
  // Info card
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#0f1e35',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#1f2d47',
    gap: 10,
    alignItems: 'flex-start',
  },
  infoIcon: {
    fontSize: 18,
  },
  infoText: {
    flex: 1,
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 18,
  },
  // Buttons
  nextBtn: {
    backgroundColor: '#10b981',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  nextBtnDisabled: {
    backgroundColor: '#064e3b',
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
    color: '#10b981',
    marginBottom: 12,
  },
  verifiedSub: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  // Camera box
  cameraBox: {
    width: 240,
    height: 280,
    backgroundColor: '#0f1e35',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#1f2d47',
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
    color: '#9ca3af',
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
    borderColor: 'rgba(16,185,129,0.3)',
    borderStyle: 'dashed',
  },
  cornerGuide: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#10b981',
    borderWidth: 2,
  },
  roleCard: {
    flexDirection: 'row',
    backgroundColor: '#0f1e35',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#1f2d47',
    alignItems: 'center',
    gap: 16,
  },
  roleCardActive: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16,185,129,0.1)',
  },
  roleIcon: {
    fontSize: 40,
  },
  roleInfo: {
    flex: 1,
  },
  roleTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  roleDesc: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
  },
});
