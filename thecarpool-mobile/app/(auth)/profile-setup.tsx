import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, StatusBar, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { User, MapPin, ArrowRight } from 'lucide-react-native';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';
import { apiFetch } from '../services/api';
import { useAuthStore } from '../store/authStore';
import auth from '@react-native-firebase/auth';
import * as haptics from '../services/haptics';
import HapticPressable from '../components/HapticPressable';

export default function ProfileSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const setUserProfile = useAuthStore((s) => s.setUserProfile);
  const skipProfileSetup = useAuthStore((s) => s.skipProfileSetup);
  const userProfile = useAuthStore((s) => s.userProfile);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [address, setAddress] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!firstName.trim()) {
      Alert.alert('First Name Required', 'Please enter your first name.');
      return;
    }
    if (!lastName.trim()) {
      Alert.alert('Last Name Required', 'Please enter your last name.');
      return;
    }

    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    setIsSaving(true);
    haptics.press();

    try {
      // 1. Update backend user profile
      const res = await apiFetch('/api/users/profile', {
        method: 'POST',
        body: JSON.stringify({
          name: fullName,
          address: address.trim() || undefined,
        }),
      });

      if (!res.ok) {
        // non-fatal
      }
    } catch {
      // Non-fatal: local profile store will still update so user is never trapped
    } finally {
      // 2. Update local Zustand auth store & navigate to tabs
      setUserProfile({
        ...(userProfile || {}),
        name: fullName,
      });

      haptics.success();
      setIsSaving(false);
      router.replace('/(tabs)');
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" backgroundColor={c.bgApp} />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.xl }]}>
        
        {/* Navigation Bar */}
        <View style={styles.navBar}>
          <HapticPressable
            style={styles.backBtn}
            onPress={() => {
              auth().signOut();
              router.replace('/(auth)/login');
            }}
          >
            <Text style={styles.backText}>← Sign Out</Text>
          </HapticPressable>

          <HapticPressable
            onPress={() => { skipProfileSetup(); router.replace('/(tabs)'); }}
          >
            <Text style={styles.skipText}>Skip for now</Text>
          </HapticPressable>
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.badge}>Step 2 of 2</Text>
          <Text style={styles.h1}>Welcome to TheCarPool!</Text>
          <Text style={styles.sub}>Let's set up your profile so co-travellers know who they're riding with.</Text>
        </View>

        {/* Form Inputs */}
        <View style={styles.form}>
          
          {/* First Name */}
          <Text style={styles.label}>First Name <Text style={styles.required}>*</Text></Text>
          <View style={styles.inputWrap}>
            <User color={c.textTertiary} size={18} />
            <TextInput
              style={styles.input}
              placeholder="e.g. Rahul"
              placeholderTextColor={c.textDisabled}
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          {/* Last Name */}
          <Text style={styles.label}>Last Name <Text style={styles.required}>*</Text></Text>
          <View style={styles.inputWrap}>
            <User color={c.textTertiary} size={18} />
            <TextInput
              style={styles.input}
              placeholder="e.g. Sharma"
              placeholderTextColor={c.textDisabled}
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          {/* Optional Address */}
          <Text style={styles.label}>Home / Work Address <Text style={styles.optional}>(Optional)</Text></Text>
          <View style={[styles.inputWrap, styles.addressWrap]}>
            <MapPin color={c.textTertiary} size={18} style={{ marginTop: 2 }} />
            <TextInput
              style={[styles.input, styles.addressInput]}
              placeholder="e.g. DLF Cyber City, Phase 2, Gurgaon"
              placeholderTextColor={c.textDisabled}
              value={address}
              onChangeText={setAddress}
              multiline
              numberOfLines={2}
              autoCapitalize="words"
            />
          </View>

        </View>

        {/* Submit Button */}
        <HapticPressable haptic="press"
          style={[styles.submitBtn, (!firstName.trim() || !lastName.trim() || isSaving) && styles.disabledBtn]}
          onPress={handleSave}
          disabled={!firstName.trim() || !lastName.trim() || isSaving}
          activeOpacity={0.9}
        >
          {isSaving ? (
            <ActivityIndicator color={c.actionPrimaryText} />
          ) : (
            <>
              <Text style={styles.submitBtnText}>Complete & Start Commuting</Text>
              <ArrowRight color={c.actionPrimaryText} size={18} strokeWidth={2.4} />
            </>
          )}
        </HapticPressable>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  content: { flexGrow: 1, paddingHorizontal: space.xl, justifyContent: 'space-between' },
  navBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.lg },
  backBtn: { paddingVertical: 6, paddingRight: 12 },
  backText: { fontFamily: font.sansSemibold, fontSize: 14, color: c.textSecondary },
  skipText: { fontFamily: font.sansMedium, fontSize: 13.5, color: c.textTertiary },
  header: { marginBottom: space.xl },
  badge: { fontFamily: font.sansBold, fontSize: 12, color: c.goStrong, backgroundColor: c.goSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start', marginBottom: 12 },
  h1: { fontFamily: font.sansExtrabold, fontSize: 28, color: c.textPrimary, letterSpacing: -0.8, lineHeight: 34 },
  sub: { fontFamily: font.sans, fontSize: 14, color: c.textTertiary, marginTop: 8, lineHeight: 20 },

  form: { gap: 14, marginBottom: 24 },
  label: { fontFamily: font.sansSemibold, fontSize: 14, color: c.textPrimary },
  required: { color: c.danger },
  optional: { fontFamily: font.sans, color: c.textTertiary, fontSize: 12.5 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surfaceCard, borderRadius: radius.md, paddingHorizontal: 14, height: 52, borderWidth: 1, borderColor: c.borderDefault, ...shadowSm },
  addressWrap: { height: 70, alignItems: 'flex-start', paddingTop: 12 },
  input: { flex: 1, fontFamily: font.sansMedium, fontSize: 15, color: c.textPrimary },
  addressInput: { textAlignVertical: 'top', paddingTop: 0 },

  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.actionPrimary, borderRadius: radius.md, height: 54, marginTop: 'auto' },
  disabledBtn: { opacity: 0.4 },
  submitBtnText: { fontFamily: font.sansBold, fontSize: 16, color: c.actionPrimaryText },
});
