import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, StatusBar, Alert,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch } from './services/api';
import * as haptics from './services/haptics';
import { useAuthStore } from './store/authStore';
import { c, font, radius, space } from '../theme/tokens';
import HapticPressable from './components/HapticPressable';

/**
 * Driving licence capture — the step that turns a rider into a partner.
 *
 * Kept as its own screen rather than another page of the signup wizard: a rider
 * only reaches it if and when they decide to offer a ride, which may be months
 * after they joined.
 */
export default function LicenceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const setVerification = useAuthStore((s) => s.setVerification);

  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [loading, setLoading] = useState(false);

  // 2-letter state code + 13 digits, e.g. DL0420110149646. Checked properly on
  // the server; this is only to keep the button honest.
  const looksValid = /^[A-Za-z]{2}[\s-]?\d{13}$/.test(number.trim());
  const expiryValid = /^\d{4}-\d{2}-\d{2}$/.test(expiry.trim());

  const submit = async (source: 'camera' | 'library') => {
    try {
      const perm = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Enable access in Settings to add your licence.');
        return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, base64: true });
      if (result.canceled || !result.assets?.[0]?.base64) return;

      setLoading(true);
      const res = await apiFetch('/api/safety/kyc/document', {
        method: 'POST',
        body: JSON.stringify({
          purpose: 'DRIVING_LICENCE',
          document_type: 'DL',
          id_number: number.trim(),
          expiry: expiry.trim(),
          image_base64: result.assets[0].base64,
        }),
      }, { timeoutMs: 45000 });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        haptics.error();
        Alert.alert('Could not verify licence', data.message || data.error || 'Please try again with a clearer photo.');
        return;
      }

      // Server tells us what the user can now do; store it rather than guessing.
      if (data.verification) setVerification(data.verification);
      haptics.success();
      Alert.alert('Licence verified', 'You can now offer rides.', [
        { text: 'Offer a ride', onPress: () => router.replace('/(tabs)/driver') },
      ]);
    } catch {
      haptics.error();
      Alert.alert('Something went wrong', 'Could not check your licence. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const pickSource = () => Alert.alert('Upload your licence', 'Add a clear photo of the front', [
    { text: 'Take photo', onPress: () => submit('camera') },
    { text: 'Choose from gallery', onPress: () => submit('library') },
    { text: 'Cancel', style: 'cancel' },
  ]);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" backgroundColor={c.bgApp} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <HapticPressable style={styles.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}>
          <Text style={styles.backText}>← Back</Text>
        </HapticPressable>

        <Text style={styles.h1}>Add your driving licence</Text>
        <Text style={styles.sub}>
          Riders only need a government ID. To offer rides, we also check your licence.
        </Text>

        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            We match the number you enter against the photo you upload. Only the last 4
            characters are kept, and the image is deleted after 15 days.
          </Text>
        </View>

        <Text style={styles.label}>Licence number</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. DL0420110149646"
          placeholderTextColor={c.textDisabled}
          value={number}
          onChangeText={(t) => setNumber(t.toUpperCase())}
          autoCapitalize="characters"
          maxLength={20}
        />

        <Text style={styles.label}>Valid until</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={c.textDisabled}
          value={expiry}
          onChangeText={setExpiry}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
        <Text style={styles.hint}>A licence has an expiry date, so this one is required.</Text>

        <HapticPressable
          haptic="press"
          style={[styles.primaryBtn, (!looksValid || !expiryValid || loading) && styles.disabled]}
          onPress={pickSource}
          disabled={!looksValid || !expiryValid || loading}
        >
          {loading
            ? <ActivityIndicator color={c.actionPrimaryText} />
            : <Text style={styles.primaryBtnText}>Upload licence photo</Text>}
        </HapticPressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  content: { flexGrow: 1, paddingHorizontal: space.xl },
  back: { paddingVertical: 8, alignSelf: 'flex-start' },
  backText: { fontFamily: font.sansSemibold, fontSize: 15, color: c.textSecondary },
  h1: { fontFamily: font.sansExtrabold, fontSize: 26, color: c.textPrimary, letterSpacing: -0.5, marginTop: space.md },
  sub: { fontFamily: font.sans, fontSize: 14, color: c.textTertiary, marginTop: 6, lineHeight: 20, marginBottom: space.lg },
  infoCard: { backgroundColor: c.surfaceCard, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: space.md, marginBottom: space.lg },
  infoText: { fontFamily: font.sans, fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },
  label: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textPrimary, marginBottom: 6 },
  input: {
    backgroundColor: c.surfaceCard, borderRadius: radius.md, height: 52, paddingHorizontal: 16,
    fontFamily: font.monoBold, fontSize: 16, color: c.textPrimary,
    borderWidth: 1, borderColor: c.borderDefault, marginBottom: space.md,
  },
  hint: { fontFamily: font.sans, fontSize: 11.5, color: c.textTertiary, marginTop: -8, marginBottom: space.lg },
  primaryBtn: { backgroundColor: c.actionPrimary, height: 54, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { fontFamily: font.sansBold, fontSize: 15.5, color: c.actionPrimaryText },
  disabled: { opacity: 0.5 },
});
