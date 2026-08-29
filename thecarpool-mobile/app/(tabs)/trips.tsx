import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Route, MapPin, Clock, CheckCircle, Circle, ChevronRight } from 'lucide-react-native';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';
import { apiFetch } from '../services/api';
import * as haptics from '../services/haptics';
import HapticPressable from '../components/HapticPressable';
import { useAuthStore } from '../store/authStore';
import { useI18n } from '../services/i18n';
import { formatMoney } from '../services/currency';
import * as Location from 'expo-location';

interface Booking {
  id: string;
  ride_id: string;
  seats_booked: number;
  payment_status: string;
  escrow_status: string;
  created_at: string;
  departure_time: string | null;
  driver_name: string | null;
  vehicle: string | null;
  vehicle_plate: string | null;
  ride_status: string | null;
  price_split: number | null;
  booking_status?: string;
  /** Set once the ride is marked finished; starts the dispute countdown. */
  completed_at?: string | null;
  disputed?: boolean;
  drop_point?: { lat: number; lng: number } | null;
  /** Rider's own 4-digit boarding code — the driver asks for this to board. */
  boarding_otp?: string | null;
  boarding_verified?: boolean;
  /** Where the ride goes, for the card. Null on rides posted before it was stored. */
  source?: string | null;
  destination?: string | null;
}

/**
 * How long the rider has to challenge a completion.
 *
 * Mirrors DISPUTE_WINDOW_MINUTES on the server, which is the authority — this
 * copy only decides whether to show the button. The server re-checks, so a
 * stale client can never dispute outside the real window.
 */
const DISPUTE_WINDOW_MINUTES = 10;

function disputeMinutesLeft(completedAt: string | null | undefined): number {
  const t = Date.parse(String(completedAt ?? ''));
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil(DISPUTE_WINDOW_MINUTES - (Date.now() - t) / 60000));
}

function statusColor(escrow: string, ride: string | null, completedAt?: string | null) {
  if (escrow === 'SETTLED' || ride === 'COMPLETED' || completedAt) return '#15803D'; // Green
  if (ride === 'STARTED' || ride === 'IN_PROGRESS') return '#C2410C'; // Orange
  if (ride === 'CANCELLED') return c.danger;
  return '#B45309'; // Yellow
}

/**
 * The booking's own state comes first, then the ride's.
 */
function statusLabel(escrow: string, ride: string | null, completedAt?: string | null, t?: any) {
  const trans = t || ((k: string) => k);
  if (escrow === 'SETTLED' || ride === 'COMPLETED') return trans('status_completed');
  if (completedAt) return trans('status_completed');
  if (ride === 'STARTED' || ride === 'IN_PROGRESS') return trans('status_ongoing');
  if (ride === 'CANCELLED') return trans('status_cancelled');
  if (ride === 'SCHEDULED') return trans('status_not_started');
  return trans('status_not_started');
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export default function TripsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activityRefreshEpoch } = useAuthStore();
  const { t } = useI18n();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/bookings/mine');
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setBookings(data.bookings ?? []);
    } catch (e: any) {
      setError('Could not load your trips. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload every time the tab comes into focus
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Instantly reload when a booking or ride is created/modified anywhere
  useEffect(() => {
    if (activityRefreshEpoch > 0) load();
  }, [activityRefreshEpoch, load]);

  // Cancel an upcoming booking. The exact charge is quoted by the server first
  // and shown to the rider before they commit — the quote and the charge share
  // the same server-side maths, so the figure in this dialog is the figure
  // actually applied.
  const cancelBooking = async (b: Booking) => {
    haptics.warning();

    let q: any = null;
    try {
      const qRes = await apiFetch(`/api/bookings/${b.id}/cancellation-quote`);
      if (qRes.ok) {
        q = await qRes.json();
      } else {
        const e = await qRes.json().catch(() => ({}));
        Alert.alert('Could not cancel', e.message || e.error || 'This booking is no longer cancellable.');
        return;
      }
    } catch {
      Alert.alert('Could not cancel', 'Network error. Please try again.');
      return;
    }

    const confirmLabel = q.cancellation_fee > 0
      ? `Cancel (${formatMoney(Number(q.cancellation_fee))} charge)`
      : t('cancel_booking');

    Alert.alert(
      q.headline || 'Cancel this booking?',
      `${q.detail}\n\nRefunds reach your TheCarPool wallet immediately and can be spent on your next ride.`,
      [
        { text: 'Keep booking', style: 'cancel' },
        {
          text: confirmLabel,
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/bookings/${b.id}/cancel`, { method: 'PATCH' });
              if (res.ok) {
                const d = await res.json().catch(() => ({}));
                haptics.success();
                Alert.alert(
                  'Booking cancelled',
                  d.cancellation_fee > 0
                    ? `A ${formatMoney(Number(d.cancellation_fee))} cancellation charge (${d.cancellation_fee_pct}%) was applied. ${formatMoney(Number(d.refunded_amount))} has been refunded to your wallet.`
                    : `${formatMoney(Number(d.refunded_amount))} has been refunded to your wallet in full.`
                );
                load(true);
                useAuthStore.getState().triggerActivityRefresh();
              } else {
                haptics.error();
                const e = await res.json().catch(() => ({}));
                Alert.alert('Could not cancel', e.message || e.error || `Server error (${res.status}).`);
              }
            } catch {
              haptics.error();
              Alert.alert('Could not cancel', 'Network error. Please try again.');
            }
          },
        },
      ]
    );
  };

  /**
   * Rider ends their own ride.
   *
   * Sends their coordinates when the OS will give them: the server then treats
   * it as an arrival and checks they really are at the drop-off. If location is
   * unavailable or refused, it falls back to a plain tap, which the server
   * accepts as a deliberate confirmation and needs no proximity check.
   */
  const completeRide = async (b: Booking) => {
    haptics.press();
    let body: Record<string, number> = {};
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        body = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
    } catch { /* fall through to the manual path */ }

    try {
      const res = await apiFetch(`/api/bookings/${b.id}/complete`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, { timeoutMs: 25000 });
      const d = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        // Not close enough for the automatic path — offer the manual one
        // rather than leaving them stuck behind a GPS reading.
        if (d.error === 'NOT_AT_DESTINATION') {
          Alert.alert(
            'Not at the drop-off yet',
            "We couldn't confirm you're at the destination. Finish the ride anyway?",
            [
              { text: 'Not yet', style: 'cancel' },
              {
                text: 'Finish ride',
                onPress: async () => {
                  const r2 = await apiFetch(`/api/bookings/${b.id}/complete`, {
                    method: 'POST', body: JSON.stringify({}),
                  }, { timeoutMs: 25000 });
                  if (r2.ok) { haptics.success(); load(true); useAuthStore.getState().triggerActivityRefresh(); }
                  else Alert.alert('Could not complete', 'Please try again.');
                },
              },
            ]
          );
          return;
        }
        Alert.alert('Could not complete', d.message || d.error || 'Please try again.');
        return;
      }

      haptics.success();
      Alert.alert(
        'Ride completed',
        `Thanks for riding. The driver is paid shortly — you have ${d.dispute_minutes_remaining ?? DISPUTE_WINDOW_MINUTES} minutes to tell us if anything was wrong.`
      );
      load(true);
      useAuthStore.getState().triggerActivityRefresh();
    } catch {
      Alert.alert('Could not complete', 'Check your connection and try again.');
    }
  };

  /** Rider says the completion was wrong. Freezes the fare pending review. */
  const disputeRide = async (b: Booking) => {
    haptics.warning();
    Alert.alert(
      'Report a problem',
      "We'll hold the payment to the driver while we look into this.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/bookings/${b.id}/dispute`, {
                method: 'POST',
                body: JSON.stringify({ reason: 'Reported from the app' }),
              }, { timeoutMs: 25000 });
              const d = await res.json().catch(() => ({} as any));
              if (!res.ok) {
                Alert.alert('Could not report', d.message || d.error || 'Please contact support.');
                return;
              }
              Alert.alert('Reported', d.message || 'Your payment is on hold while we look into this.');
              load(true);
            } catch {
              Alert.alert('Could not report', 'Check your connection and try again.');
            }
          },
        },
      ]
    );
  };

  const upcoming = bookings.filter(b => b.ride_status !== 'COMPLETED' && b.escrow_status !== 'SETTLED');
  const past = bookings.filter(b => b.ride_status === 'COMPLETED' || b.escrow_status === 'SETTLED');

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.lg }]}>
      <Text style={styles.h1}>{t('my_trips')}</Text>

      {loading ? (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color={c.go} />
        </View>
      ) : error ? (
        <View style={styles.centred}>
          <Text style={styles.errorText}>{error}</Text>
          <HapticPressable style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryText}>{t('retry')}</Text>
          </HapticPressable>
        </View>
      ) : bookings.length === 0 ? (
        <View style={styles.centred}>
          <View style={styles.iconWrap}>
            <Route color={c.textTertiary} size={28} strokeWidth={2} />
          </View>
          <Text style={styles.emptyTitle}>{t('no_trips')}</Text>
          <Text style={styles.emptySub}>
            {t('no_trips_hint')}
          </Text>
          <HapticPressable style={styles.cta} activeOpacity={0.9} onPress={() => router.push('/(tabs)')}>
            <Text style={styles.ctaText}>{t('find_a_ride')}</Text>
          </HapticPressable>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={c.go} />}
          contentContainerStyle={{ paddingBottom: 120 }}
        >
          {upcoming.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>{t('upcoming_trips')}</Text>
              {upcoming.map(b => (
                <BookingCard
                  key={b.id} b={b}
                  onPress={() => router.push(`/trip/${b.ride_id}`)}
                  onCancel={b.ride_status === 'SCHEDULED' && !b.completed_at ? () => cancelBooking(b) : undefined}
                  // Offer completion once the trip is under way and not already ended.
                  onComplete={b.ride_status === 'STARTED' && !b.completed_at && b.booking_status !== 'REQUESTED' ? () => completeRide(b) : undefined}
                  // Dispute stays available while the window is open and the fare unsettled.
                  onDispute={b.completed_at && b.escrow_status === 'HELD' && disputeMinutesLeft(b.completed_at) > 0 ? () => disputeRide(b) : undefined}
                />
              ))}
            </>
          )}
          {past.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>{t('past_trips')}</Text>
              {past.map(b => <BookingCard key={b.id} b={b} onPress={() => router.push(`/trip/${b.ride_id}`)} />)}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function BookingCard({ b, onPress, onCancel, onComplete, onDispute }: {
  b: Booking; onPress: () => void; onCancel?: () => void;
  onComplete?: () => void; onDispute?: () => void;
}) {
  const { t } = useI18n();
  const color = statusColor(b.escrow_status, b.ride_status, b.completed_at);
  const label = statusLabel(b.escrow_status, b.ride_status, b.completed_at, t);
  // Not "live" once the rider has ended their own trip.
  const isLive = b.ride_status === 'STARTED' && !b.completed_at;

  return (
    <HapticPressable style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cardTop}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={[styles.statusText, { color }]}>{label}</Text>
        {isLive && <View style={styles.livePill}><Text style={styles.liveText}>LIVE</Text></View>}
        <View style={{ flex: 1 }} />
        <ChevronRight color={c.textTertiary} size={16} />
      </View>

      {(b.source || b.destination) && (
        <View style={styles.row}>
          <MapPin color={c.textTertiary} size={13} strokeWidth={2} />
          <Text style={styles.routeText} numberOfLines={2}>
            {b.source || 'Pickup'} → {b.destination || 'Destination'}
          </Text>
        </View>
      )}

      <View style={styles.row}>
        <Clock color={c.textTertiary} size={13} strokeWidth={2} />
        <Text style={styles.meta}>{formatDate(b.departure_time)}</Text>
      </View>

      {b.driver_name && (
        <View style={styles.row}>
          <Circle color={c.go} size={10} strokeWidth={3} fill={c.go} />
          <Text style={styles.driverName}>{b.driver_name}</Text>
          {b.vehicle && <Text style={styles.vehicle}> · {b.vehicle}</Text>}
          {b.vehicle_plate && <Text style={styles.vehicle}> ({b.vehicle_plate})</Text>}
        </View>
      )}

      <View style={styles.footer}>
        <MapPin color={c.textTertiary} size={13} strokeWidth={2} />
        <Text style={styles.meta}>{b.seats_booked} seat{b.seats_booked > 1 ? 's' : ''} booked</Text>
        {b.price_split != null && (
          <Text style={styles.price}>{formatMoney(b.price_split * b.seats_booked, { decimals: 0 })} escrow</Text>
        )}
      </View>

      {/* Boarding code.
          The driver's verification prompt tells them to ask for "the code on
          their trip screen", but it only ever appeared on the trip detail page
          — a tap deeper than anyone looked. Every ride so far settled as a
          no-show because nobody found it. Put it on the card. */}
      {b.boarding_otp && !b.boarding_verified && b.booking_status !== 'REQUESTED'
        && b.ride_status !== 'CANCELLED' && !b.completed_at && (
        <View style={styles.otpBox}>
          <Text style={styles.otpLabel}>Show your driver this code to board</Text>
          <Text style={styles.otpCode}>{b.boarding_otp}</Text>
        </View>
      )}

      {b.boarding_verified && (
        <Text style={styles.otpDoneNote}>✓ Boarding confirmed by your driver</Text>
      )}

      {b.booking_status === 'REQUESTED' && (
        <Text style={styles.awaitingNote}>
          Waiting for the driver to accept. You'll be refunded in full if they can't take you.
        </Text>
      )}

      {/* The ride is under way and not yet finished — let the rider end it. */}
      {onComplete && (
        <HapticPressable style={styles.completeBtn} onPress={onComplete} activeOpacity={0.85}>
          <Text style={styles.completeText}>I've reached my destination</Text>
        </HapticPressable>
      )}

      {/* Finished, money not yet released. Say how long they have, because a
          deadline nobody was told about is not a real opportunity to object. */}
      {onDispute && !b.disputed && (
        <View style={styles.disputeBox}>
          <Text style={styles.disputeNote}>
            Ride marked complete. Payment goes to the driver shortly — {disputeMinutesLeft(b.completed_at)} min
            left to tell us if something was wrong.
          </Text>
          <HapticPressable style={styles.disputeBtn} onPress={onDispute} activeOpacity={0.85}>
            <Text style={styles.disputeText}>Something's wrong</Text>
          </HapticPressable>
        </View>
      )}

      {b.disputed && (
        <Text style={styles.disputedNote}>
          You reported a problem. Your payment is on hold while we look into it.
        </Text>
      )}

      {onCancel && (
        <HapticPressable style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.85}>
          <Text style={styles.cancelText}>Cancel booking</Text>
        </HapticPressable>
      )}
    </HapticPressable>
  );
}


const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp, paddingHorizontal: space.xl },
  h1: { fontFamily: font.sansExtrabold, fontSize: 28, color: c.textPrimary, letterSpacing: -0.5, marginBottom: space.lg },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  iconWrap: { width: 72, height: 72, borderRadius: radius.xl, backgroundColor: c.surfaceInset, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
  emptyTitle: { fontFamily: font.sansBold, fontSize: 18, color: c.textPrimary },
  emptySub: { fontFamily: font.sans, fontSize: 13.5, color: c.textTertiary, textAlign: 'center', lineHeight: 20, marginTop: 6, maxWidth: 280 },
  cta: { backgroundColor: c.actionPrimary, borderRadius: radius.md, paddingHorizontal: space.xl, height: 46, justifyContent: 'center', marginTop: space.xl },
  ctaText: { fontFamily: font.sansBold, fontSize: 15, color: c.actionPrimaryText },
  errorText: { fontFamily: font.sans, color: c.danger, textAlign: 'center', marginBottom: space.md },
  retryBtn: { backgroundColor: c.surfaceCard, borderRadius: radius.md, paddingHorizontal: space.xl, height: 42, justifyContent: 'center', borderWidth: 1, borderColor: c.borderDefault },
  retryText: { fontFamily: font.sansSemibold, color: c.textPrimary, fontSize: 14 },
  sectionLabel: { fontFamily: font.sansSemibold, fontSize: 12, color: c.textTertiary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: space.sm, marginTop: space.md },
  card: { backgroundColor: c.surfaceCard, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: space.sm, ...shadowSm },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontFamily: font.sansSemibold, fontSize: 12 },
  livePill: { marginLeft: 8, backgroundColor: '#f59e0b22', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  liveText: { fontFamily: font.sansBold, fontSize: 10, color: '#f59e0b' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  meta: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary },
  driverName: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textPrimary },
  vehicle: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: c.borderSubtle },
  price: { fontFamily: font.monoBold, fontSize: 13, color: c.textAccent, marginLeft: 'auto' },
  cancelBtn: { marginTop: space.sm, height: 38, borderRadius: radius.sm, borderWidth: 1, borderColor: c.dangerSoft, backgroundColor: c.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: font.sansSemibold, fontSize: 12.5, color: c.danger },
  awaitingNote: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginTop: 10, lineHeight: 17 },
  routeText: { flex: 1, fontFamily: font.sansSemibold, fontSize: 13, color: c.textPrimary, lineHeight: 18 },
  otpBox: {
    marginTop: 12, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center',
    backgroundColor: c.bgApp, borderWidth: 1, borderColor: c.borderSubtle,
  },
  otpLabel: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary },
  otpCode: { fontFamily: font.sansBold, fontSize: 30, letterSpacing: 8, color: c.textPrimary, marginTop: 4 },
  otpDoneNote: { fontFamily: font.sansSemibold, fontSize: 12, color: c.go, marginTop: 10 },
  completeBtn: { marginTop: 12, backgroundColor: c.go, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  completeText: { fontFamily: font.sansSemibold, fontSize: 14, color: '#fff' },
  disputeBox: { marginTop: 12, padding: 12, borderRadius: radius.md, backgroundColor: c.surfaceSunken, borderWidth: 1, borderColor: c.borderSubtle },
  disputeNote: { fontFamily: font.sans, fontSize: 12, color: c.textSecondary, lineHeight: 17 },
  disputeBtn: { marginTop: 10, paddingVertical: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: c.danger, alignItems: 'center' },
  disputeText: { fontFamily: font.sansSemibold, fontSize: 13, color: c.danger },
  disputedNote: { fontFamily: font.sans, fontSize: 12, color: c.danger, marginTop: 10, lineHeight: 17 },
});
