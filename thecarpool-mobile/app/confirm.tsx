import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import { Lock, ChevronLeft, Circle, MapPin } from 'lucide-react-native';
import { apiFetch } from './services/api';
import { useAuthStore } from './store/authStore';
import { c, font, radius, space, shadowSm } from '../theme/tokens';

function initials(name?: string) {
  if (!name) return 'D';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

/**
 * Confirm & pay — fare breakdown, escrow note, UPI/Razorpay. Receives the
 * chosen ride + route + seats from Home and creates the booking on pay.
 */
export default function ConfirmPay() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<Record<string, string>>();
  const { kycStatus, userProfile } = useAuthStore();
  const uid = auth().currentUser?.uid ?? null;
  const [paying, setPaying] = useState(false);

  const seats = Math.max(1, parseInt(p.seats || '1', 10));
  const pricePerSeat = parseFloat(p.price_split || '0');
  const seatFare = pricePerSeat * seats;
  const platformFee = Math.round(seatFare * 0.05 * 100) / 100;
  const gst = Math.round(platformFee * 0.18 * 100) / 100;
  const total = Math.round((seatFare + platformFee + gst) * 100) / 100;

  const num = (n: number) => `₹${n.toFixed(2)}`;
  const upiVpa = (userProfile?.email ? userProfile.email.split('@')[0] : 'you') + '@okhdfcbank';

  const pay = async () => {
    if (kycStatus !== 'verified') {
      Alert.alert('Verification required', 'Complete a quick verification (~2 mins) to book.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Verify now', onPress: () => router.replace('/onboarding') },
      ]);
      return;
    }
    setPaying(true);
    try {
      const res = await apiFetch('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          ride_id: p.ride_id, rider_id: uid, seats_booked: seats,
          pickup_lng: Number(p.pickup_lng), pickup_lat: Number(p.pickup_lat),
          drop_lng: Number(p.drop_lng), drop_lat: Number(p.drop_lat),
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        Alert.alert('Booking failed', e.error || `Server error (${res.status}).`);
        return;
      }
      const b = await res.json();
      const rideId = b.ride_id || b.id || p.ride_id;
      if (!rideId) {
        Alert.alert('Booking confirmed!', `Your seat is locked. Booking ref: ${b.id || 'N/A'}`);
        router.replace('/(tabs)');
        return;
      }
      router.replace(`/trip/${rideId}`);
    } catch {
      Alert.alert('Booking failed', 'Network error. Please try again.');
    } finally { setPaying(false); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} style={styles.backBtn}>
          <ChevronLeft color={c.textPrimary} size={22} />
        </TouchableOpacity>
        <Text style={styles.title}>Confirm & pay</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={{ paddingHorizontal: space.xl }}>
        {/* Driver + route */}
        <View style={styles.card}>
          <View style={styles.driverRow}>
            <View style={styles.disc}><Text style={styles.discText}>{initials(p.driver_name)}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverName}>{p.driver_name || 'Driver'}</Text>
              <Text style={styles.vehicle}>{p.vehicle || 'Shared ride'}</Text>
            </View>
            <View style={styles.seatPill}><Text style={styles.seatPillText}>{seats} seat{seats > 1 ? 's' : ''}</Text></View>
          </View>
          <View style={styles.routeBlock}>
            <View style={styles.routeLine}>
              <Circle color={c.go} size={10} strokeWidth={3} fill={c.go} />
              <Text style={styles.routeText} numberOfLines={1}>{p.origin || 'Pickup'}</Text>
            </View>
            <View style={styles.routeConnector} />
            <View style={styles.routeLine}>
              <MapPin color={c.danger} size={13} strokeWidth={2.4} />
              <Text style={styles.routeText} numberOfLines={1}>{p.destination || 'Destination'}</Text>
            </View>
          </View>
        </View>

        {/* Fare breakdown */}
        <View style={styles.card}>
          <Row label="Seat fare" value={num(seatFare)} />
          <Row label="Platform fee" value={num(platformFee)} />
          <Row label="GST" value={num(gst)} />
          <View style={styles.totalDivider} />
          <View style={styles.row}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{num(total)}</Text>
          </View>
          <View style={styles.escrow}>
            <Lock color={c.textAccent} size={13} strokeWidth={2.4} />
            <Text style={styles.escrowText}>Held in escrow — released to the driver after the ride.</Text>
          </View>
        </View>

        {/* Payment method */}
        <View style={styles.payRow}>
          <View style={styles.payIcon}><Text style={{ fontSize: 16 }}>📲</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.payTitle}>UPI · Razorpay</Text>
            <Text style={styles.payVpa}>Secured escrow — released after your ride</Text>
          </View>
        </View>
      </View>

      {/* Pay button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <TouchableOpacity style={styles.payBtn} onPress={pay} disabled={paying} activeOpacity={0.9}>
          {paying ? <ActivityIndicator color="#fff" />
            : <><Lock color="#fff" size={16} strokeWidth={2.6} /><Text style={styles.payBtnText}>Pay {num(total)} · Lock seat</Text></>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, marginBottom: space.md },
  backBtn: { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: font.sansBold, fontSize: 18, color: c.textPrimary },

  card: { backgroundColor: c.surfaceCard, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: space.md, ...shadowSm },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  disc: { width: 46, height: 46, borderRadius: radius.pill, backgroundColor: c.surfaceInset, alignItems: 'center', justifyContent: 'center' },
  discText: { fontFamily: font.sansBold, fontSize: 15, color: c.textSecondary },
  driverName: { fontFamily: font.sansBold, fontSize: 16, color: c.textPrimary },
  vehicle: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary, marginTop: 1 },
  seatPill: { backgroundColor: c.surfaceSunken, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  seatPillText: { fontFamily: font.sansSemibold, fontSize: 12, color: c.textSecondary },

  routeBlock: { marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: c.borderSubtle },
  routeLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeConnector: { width: 1, height: 16, backgroundColor: c.borderStrong, marginLeft: 5, marginVertical: 2 },
  routeText: { flex: 1, fontFamily: font.sansMedium, fontSize: 14, color: c.textPrimary },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  rowLabel: { fontFamily: font.sans, fontSize: 14, color: c.textSecondary },
  rowValue: { fontFamily: font.mono, fontSize: 14, color: c.textPrimary },
  totalDivider: { height: 1, backgroundColor: c.borderSubtle, marginVertical: 8 },
  totalLabel: { fontFamily: font.sansBold, fontSize: 16, color: c.textPrimary },
  totalValue: { fontFamily: font.monoBold, fontSize: 18, color: c.textPrimary },
  escrow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm, backgroundColor: c.accentSoft, borderRadius: radius.sm, padding: space.sm },
  escrowText: { flex: 1, fontFamily: font.sansMedium, fontSize: 11.5, color: c.textAccent },

  payRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: c.borderSubtle },
  payIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: c.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  payTitle: { fontFamily: font.sansSemibold, fontSize: 14.5, color: c.textPrimary },
  payVpa: { fontFamily: font.mono, fontSize: 12.5, color: c.textTertiary, marginTop: 1 },
  change: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textAccent },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.xl, paddingTop: space.md, backgroundColor: c.bgApp, borderTopWidth: 1, borderTopColor: c.borderSubtle },
  payBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.go, height: 54, borderRadius: radius.md },
  payBtnText: { fontFamily: font.sansBold, fontSize: 16, color: '#fff' },
});
