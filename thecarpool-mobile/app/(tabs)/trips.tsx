import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Route, MapPin, Clock, CheckCircle, Circle, ChevronRight } from 'lucide-react-native';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';
import { apiFetch } from '../services/api';

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
}

function statusColor(escrow: string, ride: string | null) {
  if (escrow === 'SETTLED') return c.go;
  if (ride === 'STARTED') return '#f59e0b';
  if (ride === 'CANCELLED') return c.danger;
  return c.textAccent;
}

function statusLabel(escrow: string, ride: string | null) {
  if (escrow === 'SETTLED') return 'Completed';
  if (ride === 'STARTED') return 'In Progress';
  if (ride === 'CANCELLED') return 'Cancelled';
  if (ride === 'SCHEDULED') return 'Upcoming';
  return 'Booked';
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

  const upcoming = bookings.filter(b => b.ride_status !== 'COMPLETED' && b.escrow_status !== 'SETTLED');
  const past = bookings.filter(b => b.ride_status === 'COMPLETED' || b.escrow_status === 'SETTLED');

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.lg }]}>
      <Text style={styles.h1}>My Trips</Text>

      {loading ? (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color={c.go} />
        </View>
      ) : error ? (
        <View style={styles.centred}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : bookings.length === 0 ? (
        <View style={styles.centred}>
          <View style={styles.iconWrap}>
            <Route color={c.textTertiary} size={28} strokeWidth={2} />
          </View>
          <Text style={styles.emptyTitle}>No trips yet</Text>
          <Text style={styles.emptySub}>
            Book a shared ride and it'll show up here — live tracking, ETA and trip history.
          </Text>
          <TouchableOpacity style={styles.cta} activeOpacity={0.9} onPress={() => router.push('/(tabs)')}>
            <Text style={styles.ctaText}>Find a ride</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={c.go} />}
          contentContainerStyle={{ paddingBottom: 120 }}
        >
          {upcoming.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Upcoming</Text>
              {upcoming.map(b => <BookingCard key={b.id} b={b} onPress={() => router.push(`/trip/${b.ride_id}`)} />)}
            </>
          )}
          {past.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Past</Text>
              {past.map(b => <BookingCard key={b.id} b={b} onPress={() => router.push(`/trip/${b.ride_id}`)} />)}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function BookingCard({ b, onPress }: { b: Booking; onPress: () => void }) {
  const color = statusColor(b.escrow_status, b.ride_status);
  const label = statusLabel(b.escrow_status, b.ride_status);
  const isLive = b.ride_status === 'STARTED';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cardTop}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={[styles.statusText, { color }]}>{label}</Text>
        {isLive && <View style={styles.livePill}><Text style={styles.liveText}>LIVE</Text></View>}
        <View style={{ flex: 1 }} />
        <ChevronRight color={c.textTertiary} size={16} />
      </View>

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
          <Text style={styles.price}>₹{(b.price_split * b.seats_booked).toFixed(0)} escrow</Text>
        )}
      </View>
    </TouchableCard>
  );
}

// Alias for JSX closing tag
const TouchableCard = TouchableOpacity;

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
});
