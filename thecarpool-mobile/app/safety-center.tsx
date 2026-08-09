import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Alert, ActivityIndicator, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShieldAlert, Share2, BadgeCheck, MapPin, PhoneCall, Plus } from 'lucide-react-native';
import { apiFetch } from './services/api';
import HapticPressable from './components/HapticPressable';
import { c, font, radius, space, shadowSm } from '../theme/tokens';

const FEATURES = [
  { icon: ShieldAlert, title: 'One-tap SOS', body: 'During any active trip, the SOS button instantly alerts your emergency contacts and TheCarPool support with your live location.' },
  { icon: Share2, title: 'Live trip sharing', body: 'Share your trip, vehicle details, and live route with trusted contacts over WhatsApp or SMS before or during a ride.' },
  { icon: BadgeCheck, title: 'Verified community', body: 'Every driver and rider completes identity verification before booking. Look for the Verified badge and trust levels on ride cards.' },
  { icon: MapPin, title: 'Route-deviation alerts', body: 'We monitor active trips against the planned route and alert you if the driver deviates beyond the safe threshold.' },
];

export default function SafetyCenter() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [contacts, setContacts] = useState<any[] | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);

  const loadContacts = async () => {
    try {
      const res = await apiFetch('/api/safety/safety/contacts');
      const d = res.ok ? await res.json() : null;
      setContacts(Array.isArray(d?.contacts) ? d.contacts : []);
    } catch {
      setContacts([]);
    }
  };

  useEffect(() => { loadContacts(); }, []);

  const addContact = async () => {
    if (!name.trim() || phone.replace(/\D/g, '').length < 10) {
      Alert.alert('Add contact', 'Enter a name and a valid phone number.');
      return;
    }
    setAdding(true);
    try {
      const res = await apiFetch('/api/safety/safety/contacts', {
        method: 'POST',
        body: JSON.stringify({ contact_name: name.trim(), contact_phone: phone.trim() }),
      });
      if (!res.ok) throw new Error();
      setName('');
      setPhone('');
      await loadContacts();
    } catch {
      Alert.alert('Could not add contact', 'Please try again.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.header}>
        <HapticPressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}>
          <Text style={styles.back}>← Back</Text>
        </HapticPressable>
        <Text style={styles.title}>Safety Centre</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xl }}>
        <View style={styles.hero}>
          <ShieldAlert color={c.goStrong} size={28} strokeWidth={2.2} />
          <Text style={styles.heroTitle}>Your safety comes first</Text>
          <Text style={styles.heroBody}>Every TheCarPool ride is backed by identity verification, live tracking, and a 24/7 safety net.</Text>
        </View>

        {FEATURES.map((f, i) => (
          <View key={i} style={styles.featureRow}>
            <View style={styles.featureIcon}><f.icon color={c.textSecondary} size={18} strokeWidth={2.2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureBody}>{f.body}</Text>
            </View>
          </View>
        ))}

        {/* Emergency contacts */}
        <Text style={styles.sectionTitle}>Emergency contacts</Text>
        <Text style={styles.sectionSub}>These people are alerted with your live location when you trigger SOS.</Text>

        {contacts === null ? (
          <ActivityIndicator color={c.goStrong} style={{ marginVertical: space.lg }} />
        ) : contacts.length === 0 ? (
          <Text style={styles.emptyText}>No contacts yet — add someone you trust below.</Text>
        ) : (
          contacts.map((ct) => (
            <View key={ct.id} style={styles.contactRow}>
              <View style={styles.contactDisc}><Text style={styles.contactInitial}>{(ct.name || '?')[0].toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactName}>{ct.name}</Text>
                <Text style={styles.contactPhone}>{ct.phone}</Text>
              </View>
            </View>
          ))
        )}

        <View style={styles.addBox}>
          <TextInput style={styles.input} placeholder="Contact name" placeholderTextColor={c.textTertiary} value={name} onChangeText={setName} />
          <TextInput style={styles.input} placeholder="Phone number" placeholderTextColor={c.textTertiary} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <HapticPressable haptic="press" style={styles.addBtn} onPress={addContact} disabled={adding} activeOpacity={0.9}>
            <Plus color="#fff" size={16} strokeWidth={2.6} />
            <Text style={styles.addBtnText}>{adding ? 'Adding…' : 'Add emergency contact'}</Text>
          </HapticPressable>
        </View>

        {/* Emergency call */}
        <HapticPressable haptic="error" style={styles.emergencyRow} onPress={() => Linking.openURL('tel:112')}>
          <PhoneCall color={c.textPrimary} size={16} strokeWidth={2.4} />
          <Text style={styles.emergencyText}>In immediate danger? Call 112 (national emergency)</Text>
        </HapticPressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingVertical: space.sm },
  back: { fontFamily: font.sansSemibold, fontSize: 14, color: c.textAccent, width: 50 },
  title: { fontFamily: font.sansBold, fontSize: 17, color: c.textPrimary },

  hero: { alignItems: 'center', backgroundColor: c.goSoft, borderRadius: radius.lg, padding: space.xl, marginBottom: space.lg },
  heroTitle: { fontFamily: font.sansBold, fontSize: 18, color: c.goStrong, marginTop: space.sm },
  heroBody: { fontFamily: font.sans, fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 4, lineHeight: 19 },

  featureRow: { flexDirection: 'row', gap: space.md, backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.md, marginBottom: space.sm, ...shadowSm },
  featureIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: c.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  featureTitle: { fontFamily: font.sansBold, fontSize: 14, color: c.textPrimary },
  featureBody: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary, marginTop: 2, lineHeight: 18 },

  sectionTitle: { fontFamily: font.sansBold, fontSize: 16, color: c.textPrimary, marginTop: space.lg },
  sectionSub: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary, marginTop: 2, marginBottom: space.md },
  emptyText: { fontFamily: font.sans, fontSize: 13, color: c.textTertiary, marginBottom: space.sm },

  contactRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  contactDisc: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  contactInitial: { fontFamily: font.sansBold, fontSize: 15, color: c.textSecondary },
  contactName: { fontFamily: font.sansSemibold, fontSize: 14, color: c.textPrimary },
  contactPhone: { fontFamily: font.mono, fontSize: 12.5, color: c.textTertiary, marginTop: 1 },

  addBox: { backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.md, marginTop: space.xs, ...shadowSm },
  input: { height: 44, borderWidth: 1, borderColor: c.borderSubtle, borderRadius: radius.sm, paddingHorizontal: 12, fontFamily: font.sans, fontSize: 14, color: c.textPrimary, backgroundColor: c.surfaceSunken, marginBottom: space.sm },
  addBtn: { flexDirection: 'row', gap: 8, height: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goStrong, borderRadius: radius.sm },
  addBtnText: { fontFamily: font.sansBold, fontSize: 14, color: '#fff' },

  emergencyRow: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: space.lg, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderStrong },
  emergencyText: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textPrimary },
});
