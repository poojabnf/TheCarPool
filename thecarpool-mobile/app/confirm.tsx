import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import { Lock, ChevronLeft, Circle, MapPin, Footprints } from 'lucide-react-native';
import RazorpayCheckout from 'react-native-razorpay';
import { apiFetch } from './services/api';
import * as haptics from './services/haptics';
import { useAuthStore } from './store/authStore';
import { c, font, radius, space, shadowSm } from '../theme/tokens';
import HapticPressable from './components/HapticPressable';

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

  // Meeting-point suggestions: points on the driver's existing route within
  // walking distance — pick one and the driver doesn't detour at all.
  type MeetingPoint = { label: string; latitude: number; longitude: number; walk_meters: number; walk_minutes: number };
  const [meetingPoints, setMeetingPoints] = useState<MeetingPoint[]>([]);
  const [chosenMp, setChosenMp] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/geo/meeting-points', {
          method: 'POST',
          body: JSON.stringify({ ride_id: p.ride_id, lat: Number(p.pickup_lat), lng: Number(p.pickup_lng) }),
        });
        if (res.ok) {
          const data = await res.json();
          setMeetingPoints(data.meeting_points || []);
        }
      } catch { /* suggestions are optional */ }
    })();
  }, [p.ride_id]);

  const seats = Math.max(1, parseInt(p.seats || '1', 10));
  const pricePerSeat = parseFloat(p.price_split || '0');

  // Pricing comes from the server so the breakdown shown here is exactly what
  // the booking endpoint will charge. Falls back to the local fare while the
  // quote is in flight.
  const [quote, setQuote] = useState<{
    fare_amount: number;
    convenience_fee: number;
    insurance_premium: number;
    insurance_available: boolean;
  } | null>(null);
  const [insuranceOpted, setInsuranceOpted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/bookings/quote?ride_id=${encodeURIComponent(String(p.ride_id))}&seats=${seats}`);
        if (res.ok) setQuote(await res.json());
      } catch { /* fall back to the local fare */ }
    })();
  }, [p.ride_id, seats]);

  const seatFare = quote?.fare_amount ?? pricePerSeat * seats;
  // Zero convenience fee — riders pay the fare, the driver receives all of it.
  const convenienceFee = quote?.convenience_fee ?? 0;
  const insurancePremium = quote?.insurance_premium ?? 0;
  const insuranceCharge = insuranceOpted ? insurancePremium : 0;
  const total = Math.round((seatFare + convenienceFee + insuranceCharge) * 100) / 100;

  const num = (n: number) => `₹${n.toFixed(2)}`;
  const upiVpa = (userProfile?.email ? userProfile.email.split('@')[0] : 'you') + '@okhdfcbank';

  const pay = async () => {
    haptics.press();
    if (kycStatus !== 'verified') {
      Alert.alert('Verification required', 'Complete a quick verification (~2 mins) to book.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Verify now', onPress: () => router.replace('/onboarding') },
      ]);
      return;
    }
    setPaying(true);
    try {
      // Step 1: Create a Razorpay order on the backend.
      const orderRes = await apiFetch('/api/payments/order', {
        method: 'POST',
        body: JSON.stringify({ amount: total, currency: 'INR', booking_id: p.ride_id }),
      });
      if (!orderRes.ok) {
        const e = await orderRes.json().catch(() => ({}));
        Alert.alert('Payment failed', e.error || 'Could not initiate payment. Please try again.');
        return;
      }
      const order = await orderRes.json();

      // Step 2: Open Razorpay Checkout with the order.
      const razorpayOptions = {
        key: order.key_id,
        order_id: order.order_id,
        amount: order.amount, // in paise, as returned by backend
        currency: order.currency,
        name: 'TheCarPool',
        description: `Ride with ${p.driver_name || 'Driver'} · ${seats} seat${seats > 1 ? 's' : ''}`,
        prefill: {
          contact: auth().currentUser?.phoneNumber || '',
          email: userProfile?.email || '',
        },
        theme: { color: '#16A34A' }, // brand green
      };

      let paymentData: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
      try {
        paymentData = await RazorpayCheckout.open(razorpayOptions);
      } catch (checkoutErr: any) {
        // User dismissed checkout or payment failed at gateway level.
        const desc = checkoutErr?.error?.description || checkoutErr?.description || 'Payment was cancelled.';
        Alert.alert('Payment cancelled', desc);
        return;
      }

      // Step 3: Create the booking, handing it the payment to consume.
      // The server verifies the captured amount with Razorpay and refuses to
      // create a seat that isn't paid for in full — there is no separate
      // wallet-credit step, so the money can't end up in the wrong place.
      const bookingRes = await apiFetch('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          ride_id: p.ride_id, rider_id: uid, seats_booked: seats,
          payment_method: 'RAZORPAY',
          razorpay_payment_id: paymentData.razorpay_payment_id,
          insurance_opted: insuranceOpted,
          // Book at the chosen meeting point (zero driver detour) when picked.
          pickup_lng: chosenMp !== null ? meetingPoints[chosenMp].longitude : Number(p.pickup_lng),
          pickup_lat: chosenMp !== null ? meetingPoints[chosenMp].latitude : Number(p.pickup_lat),
          drop_lng: Number(p.drop_lng), drop_lat: Number(p.drop_lat),
        }),
      });
      if (!bookingRes.ok) {
        const e = await bookingRes.json().catch(() => ({}));
        haptics.error();
        // The seat was never created, so the server refunds to the original
        // payment method rather than parking it in a wallet.
        Alert.alert(
          'Seat could not be booked',
          e.message || e.error || `Server error (${bookingRes.status}).`
        );
        return;
      }
      const b = await bookingRes.json();
      haptics.success(); // seat locked & paid
      const rideId = b.ride_id || b.id || p.ride_id;
      if (!rideId) {
        Alert.alert('Booking confirmed!', `Your seat is locked & paid. Booking ref: ${b.id || 'N/A'}`);
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
        <HapticPressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} style={styles.backBtn}>
          <ChevronLeft color={c.textPrimary} size={22} />
        </HapticPressable>
        <Text style={styles.title}>Confirm & pay</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
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

        {/* Meeting-point suggestions */}
        {meetingPoints.length > 0 && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Footprints color={c.textSecondary} size={16} strokeWidth={2.2} />
              <Text style={styles.mpTitle}>Walk a little, ride sooner</Text>
            </View>
            <Text style={styles.mpSub}>Meet the driver on their route — no detour, faster pickup.</Text>
            {meetingPoints.map((mp, i) => (
              <HapticPressable
                key={i}
                style={[styles.mpRow, chosenMp === i && styles.mpRowOn]}
                onPress={() => setChosenMp(chosenMp === i ? null : i)}
                activeOpacity={0.85}
              >
                <Text style={[styles.mpLabel, chosenMp === i && { color: c.goStrong }]}>{mp.label}</Text>
                <Text style={styles.mpWalk}>{mp.walk_minutes} min walk · {mp.walk_meters}m</Text>
              </HapticPressable>
            ))}
            <Text style={styles.mpHint}>
              {chosenMp !== null ? '✓ Pickup set to this meeting point' : 'Optional — skip for door pickup'}
            </Text>
          </View>
        )}

        {/* Optional journey insurance */}
        {quote?.insurance_available && (
          <HapticPressable
            style={[styles.insuranceCard, insuranceOpted && styles.insuranceCardOn]}
            onPress={() => setInsuranceOpted((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: insuranceOpted }}
          >
            <View style={[styles.insuranceBox, insuranceOpted && styles.insuranceBoxOn]}>
              {insuranceOpted && <Text style={styles.insuranceTick}>✓</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.insuranceTitle}>Add journey insurance · {num(insurancePremium)}</Text>
              <Text style={styles.insuranceSub}>
                Optional cover for this trip, priced on distance. Fully refunded if you cancel.
              </Text>
            </View>
          </HapticPressable>
        )}

        {/* Fare breakdown */}
        <View style={styles.card}>
          <Row label={`Seat fare · ${seats} seat${seats > 1 ? 's' : ''}`} value={num(seatFare)} />
          <Row label="Convenience fee" value="FREE" />
          {insuranceOpted && <Row label="Journey insurance" value={num(insuranceCharge)} />}
          <View style={styles.totalDivider} />
          <View style={styles.row}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{num(total)}</Text>
          </View>
          <View style={styles.escrow}>
            <Lock color={c.textAccent} size={13} strokeWidth={2.4} />
            <Text style={styles.escrowText}>
              Held in escrow — released to the driver only after they verify your boarding code.
            </Text>
          </View>
          <Text style={styles.policyNote}>
            Free cancellation up to 2 hours before departure. After that a 10% charge applies,
            rising to 20% within 1 hour.
          </Text>
        </View>

        {/* Payment method */}
        <View style={styles.payRow}>
          <View style={styles.payIcon}><Text style={{ fontSize: 16 }}>📲</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.payTitle}>UPI · Razorpay</Text>
            <Text style={styles.payVpa}>Secured escrow — released after your ride</Text>
          </View>
        </View>
      </ScrollView>

      {/* Pay button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <HapticPressable haptic="press" style={styles.payBtn} onPress={pay} disabled={paying} activeOpacity={0.9}>
          {paying ? <ActivityIndicator color="#fff" />
            : <><Lock color="#fff" size={16} strokeWidth={2.6} /><Text style={styles.payBtnText}>Pay {num(total)} · Lock seat</Text></>}
        </HapticPressable>
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

  mpTitle: { fontFamily: font.sansBold, fontSize: 14.5, color: c.textPrimary },
  mpSub: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginBottom: space.sm },
  mpRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: c.borderSubtle, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 6, backgroundColor: c.surfaceSunken,
  },
  mpRowOn: { borderColor: c.go, backgroundColor: c.goSoft },
  mpLabel: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textPrimary },
  mpWalk: { fontFamily: font.mono, fontSize: 12, color: c.textTertiary },
  mpHint: { fontFamily: font.sans, fontSize: 11.5, color: c.textTertiary, marginTop: 8, textAlign: 'center' },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  rowLabel: { fontFamily: font.sans, fontSize: 14, color: c.textSecondary },
  rowValue: { fontFamily: font.mono, fontSize: 14, color: c.textPrimary },
  totalDivider: { height: 1, backgroundColor: c.borderSubtle, marginVertical: 8 },
  totalLabel: { fontFamily: font.sansBold, fontSize: 16, color: c.textPrimary },
  totalValue: { fontFamily: font.monoBold, fontSize: 18, color: c.textPrimary, letterSpacing: -0.4 },
  escrow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm, backgroundColor: c.accentSoft, borderRadius: radius.sm, padding: space.sm },
  escrowText: { flex: 1, fontFamily: font.sansMedium, fontSize: 11.5, color: c.textAccent },
  policyNote: { fontFamily: font.sans, fontSize: 11, color: c.textTertiary, marginTop: space.sm, lineHeight: 15 },

  insuranceCard: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, backgroundColor: c.surfaceCard, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderSubtle, padding: space.md, marginBottom: space.md },
  insuranceCardOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
  insuranceBox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  insuranceBoxOn: { backgroundColor: c.accent, borderColor: c.accent },
  insuranceTick: { color: '#fff', fontSize: 13, fontFamily: font.sansBold, lineHeight: 16 },
  insuranceTitle: { fontFamily: font.sansBold, fontSize: 13.5, color: c.textPrimary },
  insuranceSub: { fontFamily: font.sans, fontSize: 11.5, color: c.textTertiary, marginTop: 2, lineHeight: 15 },

  payRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: c.borderSubtle },
  payIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: c.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  payTitle: { fontFamily: font.sansSemibold, fontSize: 14.5, color: c.textPrimary },
  payVpa: { fontFamily: font.mono, fontSize: 12.5, color: c.textTertiary, marginTop: 1 },
  change: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textAccent },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.xl, paddingTop: space.md, backgroundColor: c.bgApp, borderTopWidth: 1, borderTopColor: c.borderSubtle },
  payBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.go, height: 54, borderRadius: radius.md },
  payBtnText: { fontFamily: font.sansBold, fontSize: 16, color: '#fff' },
});
