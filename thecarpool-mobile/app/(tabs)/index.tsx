import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import { MapPin, Circle, Search, BadgeCheck, Wind, Venus, Users, Leaf } from 'lucide-react-native';
import { apiFetch } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { c, font, radius, space, shadowSm, brass } from '../../theme/tokens';

interface Ride {
  id: string | number;
  driver_name: string;
  seats_available: number;
  price_split: number;
  departure_time: string;
  vehicle_type?: string;
  ac_available?: boolean;
  is_ev?: boolean;
  pickup_deviation?: number;
}

type Coords = { lat: number; lng: number };

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function initials(name?: string) {
  if (!name) return 'You';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

// Module-level so it keeps a stable component identity across keystrokes —
// otherwise React remounts it on every render and Android drops the
// async-populated suggestion list (iOS tolerates it).
function Suggestions({ items, onPick }: { items: any[]; onPick: (s: any) => void }) {
  if (!items || items.length === 0) return null;
  return (
    <View style={styles.suggBox}>
      {items.slice(0, 5).map((s, i) => (
        <TouchableOpacity key={i} style={styles.suggItem} onPress={() => onPick(s)}>
          <MapPin color={c.textDisabled} size={14} />
          <Text style={styles.suggText} numberOfLines={1}>
            {s.place_name}{s.state_name ? `, ${s.state_name}` : ''}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = auth().currentUser?.uid ?? null;
  const { kycStatus, userProfile } = useAuthStore();
  const kycVerified = kycStatus === 'verified';
  const name = userProfile?.name || 'there';

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [originCoords, setOriginCoords] = useState<Coords | null>(null);
  const [destCoords, setDestCoords] = useState<Coords | null>(null);
  const [originSug, setOriginSug] = useState<any[]>([]);
  const [destSug, setDestSug] = useState<any[]>([]);
  const [seats, setSeats] = useState(1);
  const [womenOnly, setWomenOnly] = useState(false);
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [searching, setSearching] = useState(false);

  const originTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (originTimeoutRef.current) clearTimeout(originTimeoutRef.current);
      if (destTimeoutRef.current) clearTimeout(destTimeoutRef.current);
    };
  }, []);

  const searchGeo = async (q: string, set: (s: any[]) => void, timeoutRef: React.MutableRefObject<any>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (q.trim().length < 3) { set([]); return; }

    timeoutRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/geo/search?query=${encodeURIComponent(q)}`);
        if (!res.ok) { set([]); return; }
        const data = await res.json();
        set(data.results || data.suggestions || (Array.isArray(data) ? data : []));
      } catch { set([]); }
    }, 300);
  };

  const findRides = async () => {
    if (!originCoords || !destCoords) {
      Alert.alert('Select locations', 'Pick a pickup and destination from the suggestions.');
      return;
    }
    setSearching(true);
    try {
      const res = await apiFetch('/api/rides/search', {
        method: 'POST',
        body: JSON.stringify({
          pickup_lng: originCoords.lng, pickup_lat: originCoords.lat,
          drop_lng: destCoords.lng, drop_lat: destCoords.lat,
          max_detour_meters: 1500,
          gender_preference: womenOnly ? 'FEMALE' : 'ANY',
        }),
      });
      const data = res.ok ? await res.json() : [];
      setRides(Array.isArray(data) ? data : []);
    } catch {
      setRides([]);
    } finally { setSearching(false); }
  };

  // Open Confirm & pay (fare shown before the KYC gate; confirm screen books).
  const bookRide = (ride: Ride) => {
    if (!originCoords || !destCoords) {
      Alert.alert('Select locations', 'Pick a pickup and destination from the suggestions.');
      return;
    }
    router.push({
      pathname: '/confirm',
      params: {
        ride_id: String(ride.id),
        driver_name: ride.driver_name,
        vehicle: `${ride.vehicle_type || 'Car'}${ride.ac_available ? ' · AC' : ''}`,
        price_split: String(ride.price_split),
        seats: String(seats),
        pickup_lat: String(originCoords.lat), pickup_lng: String(originCoords.lng),
        drop_lat: String(destCoords.lat), drop_lng: String(destCoords.lng),
        origin, destination,
      },
    });
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: insets.top + space.sm, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Greeting */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting()}</Text>
          <Text style={styles.name}>{name}</Text>
        </View>
        <TouchableOpacity style={styles.avatar} onPress={() => router.push('/(tabs)/account')} activeOpacity={0.8}>
          {userProfile?.photoUrl
            ? <Image source={{ uri: userProfile.photoUrl }} style={styles.avatarImg} />
            : <Text style={styles.avatarText}>{initials(userProfile?.name)}</Text>}
        </TouchableOpacity>
      </View>

      {/* Search card */}
      <View style={styles.card}>
        <View style={styles.field}>
          <Circle color={c.go} size={11} strokeWidth={3} fill={c.go} />
          <TextInput
            style={styles.input} value={origin}
            onChangeText={(t) => { setOrigin(t); setOriginCoords(null); searchGeo(t, setOriginSug, originTimeoutRef); }}
            placeholder="From — pickup point" placeholderTextColor={c.textDisabled}
          />
        </View>
        <Suggestions items={originSug} onPick={(s) => {
          setOrigin(s.place_name); setOriginCoords({ lat: s.latitude ?? s.lat ?? 0, lng: s.longitude ?? s.lng ?? 0 }); setOriginSug([]);
        }} />
        <View style={styles.divider} />
        <View style={styles.field}>
          <MapPin color={c.danger} size={14} strokeWidth={2.4} />
          <TextInput
            style={styles.input} value={destination}
            onChangeText={(t) => { setDestination(t); setDestCoords(null); searchGeo(t, setDestSug, destTimeoutRef); }}
            placeholder="To — destination" placeholderTextColor={c.textDisabled}
          />
        </View>
        <Suggestions items={destSug} onPick={(s) => {
          setDestination(s.place_name); setDestCoords({ lat: s.latitude ?? s.lat ?? 0, lng: s.longitude ?? s.lng ?? 0 }); setDestSug([]);
        }} />

        {/* Seats + Women only */}
        <View style={styles.optRow}>
          <View style={styles.seatBox}>
            <Users color={c.textTertiary} size={15} />
            <TouchableOpacity onPress={() => setSeats((s) => Math.max(1, s - 1))}><Text style={styles.stepper}>−</Text></TouchableOpacity>
            <Text style={styles.seatCount}>{seats}</Text>
            <TouchableOpacity onPress={() => setSeats((s) => Math.min(4, s + 1))}><Text style={styles.stepper}>+</Text></TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.womenChip, womenOnly && styles.womenChipOn]}
            onPress={() => setWomenOnly((v) => !v)} activeOpacity={0.85}
          >
            <Venus color={womenOnly ? '#fff' : c.textAccent} size={14} strokeWidth={2.4} />
            <Text style={[styles.womenChipText, womenOnly && { color: '#fff' }]}>Women only</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.findBtn} onPress={findRides} disabled={searching} activeOpacity={0.9}>
          {searching ? <ActivityIndicator color={c.actionPrimaryText} />
            : <><Search color={c.actionPrimaryText} size={17} strokeWidth={2.4} /><Text style={styles.findBtnText}>Find shared rides</Text></>}
        </TouchableOpacity>
      </View>

      {/* Results */}
      {rides !== null && (
        <View style={{ marginTop: space.xl }}>
          <Text style={styles.sectionTitle}>
            {rides.length > 0 ? `${rides.length} driver${rides.length > 1 ? 's' : ''} on your route` : 'No matches found'}
          </Text>
          {rides.length === 0 && <Text style={styles.muted}>Try a wider area, fewer filters, or check back shortly.</Text>}
          {rides.map((ride) => (
            <View key={String(ride.id)} style={styles.rideCard}>
              <View style={styles.rideTop}>
                <View style={styles.driverDisc}><Text style={styles.driverDiscText}>{initials(ride.driver_name)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverName}>{ride.driver_name}</Text>
                  <Text style={styles.vehicle}>
                    {(ride.vehicle_type || 'Car')}{ride.is_ev ? ' · EV' : ''}{ride.ac_available ? ' · AC' : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.fare}>₹{Number(ride.price_split).toFixed(0)}</Text>
                  <Text style={styles.perSeat}>per seat</Text>
                </View>
              </View>
              <View style={styles.badgeRow}>
                <View style={styles.badge}><BadgeCheck color={c.goStrong} size={12} strokeWidth={2.4} /><Text style={styles.badgeText}>Verified</Text></View>
                {ride.ac_available && <View style={styles.badge}><Wind color={c.info} size={12} strokeWidth={2.4} /><Text style={styles.badgeText}>AC</Text></View>}
                {womenOnly && <View style={styles.badge}><Venus color={c.textAccent} size={12} strokeWidth={2.4} /><Text style={styles.badgeText}>Women only</Text></View>}
                {ride.pickup_deviation != null && <Text style={styles.detour}>{Math.round(ride.pickup_deviation)}m detour</Text>}
              </View>
              <TouchableOpacity style={styles.bookBtn} onPress={() => bookRide(ride)} activeOpacity={0.9}>
                <Text style={styles.bookBtnText}>Book this ride · ₹{Number(ride.price_split).toFixed(0)}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Frequent routes + CO2 (shown before searching) */}
      {rides === null && (
        <>
          <Text style={styles.sectionTitle}>Frequent routes</Text>
          {[
            { t: 'Morning commute', s: 'Home → Office · Mon–Fri' },
            { t: 'Evening return', s: 'Office → Home · 6:45 PM' },
          ].map((r) => (
            <View key={r.t} style={styles.routeRow}>
              <View style={styles.routeDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeTitle}>{r.t}</Text>
                <Text style={styles.routeSub}>{r.s}</Text>
              </View>
            </View>
          ))}
          <View style={styles.co2Card}>
            <View style={styles.co2Icon}><Leaf color={c.goStrong} size={20} strokeWidth={2.2} /></View>
            <View>
              <Text style={styles.co2Label}>You've avoided</Text>
              <Text style={styles.co2Value}>142 kg<Text style={styles.co2Unit}>  CO₂ this quarter</Text></Text>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.lg },
  greeting: { fontFamily: font.sansMedium, fontSize: 13, color: c.textTertiary },
  name: { fontFamily: font.sansExtrabold, fontSize: 22, color: c.textPrimary, letterSpacing: -0.4 },
  avatar: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: c.textPrimary, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: 42, height: 42, borderRadius: radius.pill },
  avatarText: { fontFamily: font.sansBold, fontSize: 14, color: '#fff' },

  card: { backgroundColor: c.surfaceCard, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: c.borderSubtle, ...shadowSm },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 40 },
  input: { flex: 1, fontFamily: font.sansMedium, fontSize: 15, color: c.textPrimary, padding: 0 },
  divider: { height: 1, backgroundColor: c.borderSubtle, marginLeft: 22, marginVertical: 2 },
  suggBox: { backgroundColor: c.surfaceSunken, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderSubtle, marginTop: 4 },
  suggItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  suggText: { flex: 1, fontFamily: font.sans, fontSize: 13, color: c.textSecondary },

  optRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  seatBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surfaceSunken, borderRadius: radius.sm, paddingHorizontal: 12, height: 38, borderWidth: 1, borderColor: c.borderSubtle },
  stepper: { fontFamily: font.sansBold, fontSize: 18, color: c.textSecondary, width: 16, textAlign: 'center' },
  seatCount: { fontFamily: font.monoBold, fontSize: 14, color: c.textPrimary, minWidth: 14, textAlign: 'center' },
  womenChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: brass[300], backgroundColor: c.accentSoft },
  womenChipOn: { backgroundColor: c.textAccent, borderColor: c.textAccent },
  womenChipText: { fontFamily: font.sansSemibold, fontSize: 12.5, color: c.textAccent },

  findBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.actionPrimary, height: 50, borderRadius: radius.md, marginTop: space.md },
  findBtnText: { fontFamily: font.sansBold, fontSize: 15.5, color: c.actionPrimaryText },

  sectionTitle: { fontFamily: font.sansBold, fontSize: 16, color: c.textPrimary, marginBottom: space.md, marginTop: space.lg },
  muted: { fontFamily: font.sans, fontSize: 13, color: c.textTertiary },

  rideCard: { backgroundColor: c.surfaceCard, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: space.md, ...shadowSm },
  rideTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  driverDisc: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: c.surfaceInset, alignItems: 'center', justifyContent: 'center' },
  driverDiscText: { fontFamily: font.sansBold, fontSize: 14, color: c.textSecondary },
  driverName: { fontFamily: font.sansBold, fontSize: 15.5, color: c.textPrimary },
  vehicle: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary, marginTop: 1 },
  fare: { fontFamily: font.monoBold, fontSize: 19, color: c.textPrimary },
  perSeat: { fontFamily: font.sans, fontSize: 11, color: c.textTertiary },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: space.md },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.surfaceSunken, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontFamily: font.sansSemibold, fontSize: 11, color: c.textSecondary },
  detour: { fontFamily: font.mono, fontSize: 11, color: c.textTertiary, marginLeft: 'auto' },
  bookBtn: { backgroundColor: c.go, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: space.md },
  bookBtnText: { fontFamily: font.sansBold, fontSize: 14.5, color: '#fff' },

  routeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: space.sm },
  routeDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, borderColor: c.accent },
  routeTitle: { fontFamily: font.sansSemibold, fontSize: 14, color: c.textPrimary },
  routeSub: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginTop: 1 },

  co2Card: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.goSoft, borderRadius: radius.lg, padding: space.lg, marginTop: space.md },
  co2Icon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  co2Label: { fontFamily: font.sansMedium, fontSize: 12.5, color: c.goStrong },
  co2Value: { fontFamily: font.monoBold, fontSize: 20, color: c.textPrimary, marginTop: 2 },
  co2Unit: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary },
});
