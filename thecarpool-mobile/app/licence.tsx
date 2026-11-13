import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '../services/api';
import * as haptics from '../services/haptics';
import { c, font, radius, space } from '../theme/tokens';
import Button from '../components/Button';

/** YYYY-MM-DD typed as digits; the dashes are inserted as you go. */
function formatDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export default function LicenceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [dl, setDl] = useState('');
  const [expiry, setExpiry] = useState('');
  const [dob, setDob] = useState('');
  const [saving, setSaving] = useState(false);

  const ready = dl.replace(/[\s-]/g, '').length >= 10 && isDate(expiry) && isDate(dob);

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/users/licence', {
        method: 'POST',
        body: JSON.stringify({ dl_number: dl, dl_expiry: expiry, dob }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        haptics.error?.();
        Alert.alert('Could not save licence', data.message || data.error || 'Please check the details and try again.');
        return;
      }
      haptics.success();
      Alert.alert(
        data.verified ? 'Licence verified' : 'Licence saved',
        data.verified
          ? 'Your licence matches the transport department record.'
          : 'We saved your licence. It will show as verified once it has been checked.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch {
      Alert.alert('Network error', 'Could not reach the server. Check your connection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bgApp }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Driving licence</Text>
        <Text style={styles.sub}>
          Riders only see drivers who have added a valid licence. We check it against the transport department record where we can.
        </Text>

        <Text style={styles.label}>Licence number</Text>
        <TextInput
          style={styles.input}
          value={dl}
          onChangeText={(t) => setDl(t.toUpperCase())}
          placeholder="e.g. DL-0420110012345"
          placeholderTextColor={c.textSecondary}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Licence number"
        />

        <Text style={styles.label}>Valid until (YYYY-MM-DD)</Text>
        <TextInput style={styles.input} value={expiry} onChangeText={(t) => setExpiry(formatDate(t))} placeholder="2032-05-31" placeholderTextColor={c.textSecondary} keyboardType="number-pad" accessibilityLabel="Licence expiry date" />

        <Text style={styles.label}>Your date of birth (YYYY-MM-DD)</Text>
        <TextInput style={styles.input} value={dob} onChangeText={(t) => setDob(formatDate(t))} placeholder="1990-01-15" placeholderTextColor={c.textSecondary} keyboardType="number-pad" accessibilityLabel="Date of birth" />
        <Text style={styles.hint}>Needed to match your licence record. We do not show it to anyone.</Text>

        <Button label="Save licence" variant="go" size="lg" block loading={saving} disabled={!ready} onPress={save} style={{ marginTop: space.xl }} />
        <Button label="Not now" variant="ghost" block onPress={() => router.back()} style={{ marginTop: space.sm }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16 },
  title: { fontSize: 26, fontWeight: '800', color: c.textPrimary, fontFamily: font.display as any },
  sub: { fontSize: 14, color: c.textSecondary, marginTop: space.xs, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '700', color: c.textPrimary, marginTop: space.lg, marginBottom: space.xs },
  input: { backgroundColor: c.surfaceCard, borderWidth: 1, borderColor: c.borderDefault, borderRadius: radius.sm, paddingHorizontal: 14, height: 48, fontSize: 16, color: c.textPrimary },
  hint: { fontSize: 12, color: c.textSecondary, marginTop: space.xs },
});
