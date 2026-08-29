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
  Platform,
} from 'react-native';
import { apiFetch } from '../services/api';
import { auth } from '../services/firebase';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import HapticPressable from '../components/HapticPressable';

const { width } = Dimensions.get('window');
const TOTAL_STEPS = 2;

// ─── Step indicators ──────────────────────────────────────────────
function ProgressBar({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  return (
    <View style={styles.progressContainer}>
      {Array(totalSteps)
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
              {i < totalSteps - 1 && (
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

const STEP_LABELS = ['Role', 'Profile'];
const STEP_ICONS = ['🚗', '👤'];
const STEP_DESCRIPTIONS = [
  'Choose how you want to use the app',
  'Tell us about yourself',
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
function StepProfile({ onNext, isLastStep }: { onNext: (data: any) => void; isLastStep: boolean }) {
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
        <Text style={styles.nextBtnText}>{isLastStep ? "You're all set →" : 'Continue →'}</Text>
      </HapticPressable>
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

        await apiFetch('/api/users/profile', {
          method: 'POST',
          body: JSON.stringify({
            name: fullProfile.name,
            displayName: fullProfile.name,
            address: fullProfile.address,
            role: fullProfile.role,
          }),
        });

        // Keep local profile and Firebase auth displayName in sync
        const user = auth().currentUser;
        if (user && fullProfile.name) {
          user.updateProfile({ displayName: fullProfile.name }).catch(() => {});
        }

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
    <StepProfile key="profile" onNext={(d) => handleNext(d)} isLastStep />,
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAFBFC" />

      {/* Header */}
      <View style={styles.header}>
        <HapticPressable onPress={() => {
          Alert.alert(
            'Skip Setup?',
            'You can browse rides, but finishing your profile helps people recognise you.',
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
      <ProgressBar currentStep={currentStep} totalSteps={TOTAL_STEPS} />

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
