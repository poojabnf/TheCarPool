import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, Alert, ActivityIndicator, Image,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import { MapPin, Circle, Search, Wind, Venus, Users, Leaf, Clock } from 'lucide-react-native';
import { apiFetch } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useI18n } from '../services/i18n';
import * as haptics from '../services/haptics';
import { c, font, radius, space, shadowSm, brass } from '../../theme/tokens';
import HapticPressable from '../components/HapticPressable';
import { formatMoney } from '../services/currency';
import { searchPlaces, MIN_QUERY_LENGTH, SEARCH_DEBOUNCE_MS, warmUp } from '../services/geo';
import { formatDeparture, isDepartingSoon, formatPostedAgo } from '../services/datetime';
import VehicleIcon from '../components/VehicleIcon';

// Offline-cached search (roadmap Phase 1, session-scoped): module-level so it
// survives tab switches. A persistent cache needs AsyncStorage, which is a
// native module — deferred to the next store build to stay OTA-compatible.
let lastSearch: { key: string; rides: Ride[] } | null = null;

interface Ride {
  id: string | number;
  driver_name: string;
  /** Route endpoints as the driver named them. Null on rides posted before
   *  they were stored, which is why every render site guards for it. */
  source?: string | null;
  destination?: string | null;
  seats_available: number;
  price_split: number;
  departure_time: string;
  created_at?: string | null;
  vehicle_type?: string;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_colour?: string | null;
  /** Size class decided server-side; drives the icon riders scan for. */
  vehicle_class?: string | null;
  vehicle_plate?: string | null;
  ac_available?: boolean;
  is_ev?: boolean;
  pickup_deviation?: number;
}

/**
 * "Maruti Swift · White" when the driver filled it in, falling back to the
 * bare vehicle type so older rides (posted before these fields existed) still
 * render something sensible rather than an empty line.
 */
function vehicleLabel(ride: Ride): string {
  const named = [ride.vehicle_make, ride.vehicle_model].filter(Boolean).join(' ').trim();
  const head = named || (ride.vehicle_type ? ride.vehicle_type.charAt(0) + ride.vehicle_type.slice(1).toLowerCase() : 'Car');
  return [head, ride.vehicle_colour || null].filter(Boolean).join(' · ');
}

type Coords = { lat: number; lng: number };

/** A ride you're driving, or a seat you've booked — shown as a home shortcut. */
interface ActivityItem {
  kind: 'OFFERED' | 'BOOKED';
  id: string;
  /** Departure time where known; used only for ordering. */
  at?: string | null;
  title: string;
  subtitle: string;
  href: string;
  statusLabel: string;
  statusColor: string;
  statusBg: string;
  statusBorder: string;
}

type WhenKey = 'ANY' | 'NOW' | 'TODAY' | 'TOMORROW';

const WHEN_OPTIONS: { key: WhenKey; label: string }[] = [
  { key: 'ANY', label: 'Anytime' },
  { key: 'NOW', label: 'Next 2h' },
  { key: 'TODAY', label: 'Today' },
  { key: 'TOMORROW', label: 'Tomorrow' },
];

/**
 * Translate a "when" chip into the ISO window the search API filters on.
 * ANY sends nothing, so the backend keeps its "everything upcoming" default.
 */
function departureWindow(key: WhenKey): { departure_from?: string; departure_to?: string } {
  const now = new Date();
  switch (key) {
    case 'NOW': {
      const to = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      return { departure_to: to.toISOString() };
    }
    case 'TODAY': {
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { departure_to: end.toISOString() };
    }
    case 'TOMORROW': {
      const start = new Date(now);
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { departure_from: start.toISOString(), departure_to: end.toISOString() };
    }
    default:
      return {};
  }
}

function greetingKey(): 'good_morning' | 'good_afternoon' | 'good_evening' {
  const h = new Date().getHours();
  if (h < 12) return 'good_morning';
  if (h < 17) return 'good_afternoon';
  return 'good_evening';
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
        <HapticPressable key={i} style={styles.suggItem} onPress={() => onPick(s)}>
          <MapPin color={c.textDisabled} size={14} />
          <Text style={styles.suggText} numberOfLines={1}>
            {s.place_name}{s.state_name ? `, ${s.state_name}` : ''}
          </Text>
        </HapticPressable>
      ))}
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = auth().currentUser?.uid ?? null;
  const { userProfile, activityRefreshEpoch } = useAuthStore();
  const name = userProfile?.name || 'there';

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [originCoords, setOriginCoords] = useState<Coords | null>(null);
  const [destCoords, setDestCoords] = useState<Coords | null>(null);
  const [originSug, setOriginSug] = useState<any[]>([]);
  const [destSug, setDestSug] = useState<any[]>([]);
  const [seats, setSeats] = useState(1);
  const [womenOnly, setWomenOnly] = useState(false);
  const [when, setWhen] = useState<WhenKey>('ANY');
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Surfaced under the inputs so a failed lookup isn't just an empty dropdown.
  const [geoError, setGeoError] = useState('');
  const [showingCached, setShowingCached] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [bookedRideIds, setBookedRideIds] = useState<Record<string, string>>({});
  const { t } = useI18n();

  const originTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Rides you're driving and seats you've booked, newest first.
   *
   * Refetched whenever the tab regains focus or an activity change is published
   * so a booking or ride posted anywhere in the app shows up immediately.
   */
  const loadActivity = useCallback(async () => {
    try {
      const [bookingsRes, ridesRes] = await Promise.all([
        apiFetch('/api/bookings/mine'),
        apiFetch('/api/rides/mine'),
      ]);

      const items: ActivityItem[] = [];
      const bookedMap: Record<string, string> = {};

      if (bookingsRes.ok) {
        const d = await bookingsRes.json();
        for (const b of (d.bookings ?? [])) {
          if (b.ride_status === 'CANCELLED') continue;
          const isOngoing = b.ride_status === 'STARTED' || b.ride_status === 'IN_PROGRESS';
          const isCompleted = b.ride_status === 'COMPLETED';
          const isRequested = b.booking_status === 'REQUESTED';

          if (b.ride_id) {
            bookedMap[String(b.ride_id)] = isCompleted ? 'Completed' : isRequested ? 'Requested' : 'Booked';
          }

          items.push({
            kind: 'BOOKED',
            id: String(b.id),
            at: b.departure_time || b.created_at,
            title: b.driver_name ? `Ride with ${b.driver_name}` : 'Your booking',
            subtitle: [
              formatDeparture(b.departure_time),
              b.vehicle,
            ].filter(Boolean).join(' · '),
            href: `/trip/${b.ride_id}`,
            statusLabel: isCompleted ? 'Completed' : isOngoing ? 'Ongoing' : isRequested ? 'Awaiting driver' : 'Confirmed',
            statusColor: isCompleted ? '#15803D' : isOngoing ? '#C2410C' : '#B45309',
            statusBg: isCompleted ? '#DCFCE7' : isOngoing ? '#FFEDD5' : '#FEF3C7',
            statusBorder: isCompleted ? '#BBF7D0' : isOngoing ? '#FED7AA' : '#FDE68A',
          });
        }
      }
      setBookedRideIds(bookedMap);

      if (ridesRes.ok) {
        const d = await ridesRes.json();
        for (const r of (Array.isArray(d) ? d : (d.rides ?? []))) {
          if (r.status === 'CANCELLED') continue;
          const isOngoing = r.status === 'STARTED' || r.status === 'IN_PROGRESS';
          const isCompleted = r.status === 'COMPLETED';

          const seatsBooked = typeof r.seats_total === 'number' && typeof r.seats_available === 'number'
            ? r.seats_total - r.seats_available
            : null;

          items.push({
            kind: 'OFFERED',
            id: String(r.id),
            at: r.departure_time,
            title: `${r.source ?? 'Pickup'} → ${r.destination ?? 'Destination'}`,
            subtitle: [
              formatDeparture(r.departure_time),
              seatsBooked !== null ? `${seatsBooked}/${r.seats_total} booked` : null,
            ].filter(Boolean).join(' · '),
            href: '/(tabs)/driver',
            // Yellow: Not yet started | Orange: Started / Ongoing | Green: Completed
            statusLabel: isCompleted ? 'Completed' : isOngoing ? 'Started' : 'Not yet started',
            statusColor: isCompleted ? '#15803D' : isOngoing ? '#C2410C' : '#B45309',
            statusBg: isCompleted ? '#DCFCE7' : isOngoing ? '#FFEDD5' : '#FEF3C7',
            statusBorder: isCompleted ? '#BBF7D0' : isOngoing ? '#FED7AA' : '#FDE68A',
          });
        }
      }

      // Prioritize ongoing, then upcoming (not yet started), then completed
      items.sort((a, b) => {
        if (a.statusLabel === 'Started' || a.statusLabel === 'Ongoing') return -1;
        if (b.statusLabel === 'Started' || b.statusLabel === 'Ongoing') return 1;
        return String(a.at ?? '').localeCompare(String(b.at ?? ''));
      });
      setActivity(items.slice(0, 6));
    } catch {
      /* a shortcut list is not worth an error state */
    }
  }, []);

  useFocusEffect(useCallback(() => { loadActivity(); }, [loadActivity]));

  // Auto-sync when a new ride or booking is triggered globally
  useEffect(() => {
    loadActivity();
  }, [activityRefreshEpoch, loadActivity]);

  // Periodic refresh so home screen stays up-to-date in real time
  useEffect(() => {
    const timer = setInterval(() => {
      loadActivity();
    }, 15000);
    return () => clearInterval(timer);
  }, [loadActivity]);

  useEffect(() => {
    // Wake the backend now rather than on the first keystroke — see warmUp().
    warmUp();
    return () => {
      if (originTimeoutRef.current) clearTimeout(originTimeoutRef.current);
      if (destTimeoutRef.current) clearTimeout(destTimeoutRef.current);
    };
  }, []);

  const searchGeo = async (q: string, set: (s: any[]) => void, timeoutRef: React.MutableRefObject<any>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (q.trim().length < MIN_QUERY_LENGTH) { set([]); setGeoError(''); return; }

    timeoutRef.current = setTimeout(async () => {
      const outcome = await searchPlaces(q);
      if (outcome.status === 'ok') {
        set(outcome.places);
        setGeoError(outcome.places.length === 0 ? 'No places found for that search.' : '');
      } else if (outcome.status === 'error') {
        set([]);
        setGeoError(outcome.message);
      }
    }, SEARCH_DEBOUNCE_MS);
  };

  const findRides = async () => {
    haptics.tap();
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
          ...departureWindow(when),
          // Women-safety mode: backend returns women-only rides + women drivers,
          // and enforces that the searcher is female.
          women_only: womenOnly,
        }),
      });
      if (res.status === 403 && womenOnly) {
        const err = await res.json().catch(() => null);
        Alert.alert('Women-safety mode', err?.message || 'Set your gender to Female in your profile to use women-safety mode.');
        setRides([]);
        return;
      }
      const data = res.ok ? await res.json() : [];
      const list = Array.isArray(data) ? data : [];
      setRides(list);
      setShowingCached(false);
      if (res.ok) {
        lastSearch = { key: `${originCoords.lat},${originCoords.lng}>${destCoords.lat},${destCoords.lng}`, rides: list };
      }
    } catch {
      // Network failure — fall back to the last successful results if any.
      if (lastSearch) {
        setRides(lastSearch.rides);
        setShowingCached(true);
      } else {
        setRides([]);
      }
    } finally { setSearching(false); }
  };

  // Open Confirm & pay (confirm screen books).
  const bookRide = (ride: Ride) => {
    haptics.press();
    if (!originCoords || !destCoords) {
      Alert.alert('Select locations', 'Pick a pickup and destination from the suggestions.');
      return;
    }
    // The seat stepper is set before results exist, so it can ask for more
    // seats than a given ride has. Catch it here rather than letting the
    // rider reach checkout and have the booking rejected server-side.
    if (ride.seats_available != null && seats > ride.seats_available) {
      Alert.alert(
        'Not enough seats',
        `This ride has ${ride.seats_available} seat${ride.seats_available === 1 ? '' : 's'} left, but you asked for ${seats}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: `Book ${ride.seats_available}`, onPress: () => { setSeats(ride.seats_available); } },
        ]
      );
      return;
    }
    router.push({
      pathname: '/confirm',
      params: {
        ride_id: String(ride.id),
        driver_name: ride.driver_name,
        vehicle: `${vehicleLabel(ride)}${ride.ac_available ? ' · AC' : ''}`,
        vehicle_plate: ride.vehicle_plate || '',
        price_split: String(ride.price_split),
        seats: String(seats),
        departure_time: ride.departure_time || '',
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
          <Text style={styles.greeting}>{t(greetingKey())}</Text>
          <Text style={styles.name}>{name}</Text>
        </View>
        <HapticPressable style={styles.avatar} onPress={() => router.push('/(tabs)/account')} activeOpacity={0.8}>
          {userProfile?.photoUrl
            ? <Image source={{ uri: userProfile.photoUrl }} style={styles.avatarImg} />
            : <Text style={styles.avatarText}>{initials(userProfile?.name)}</Text>}
        </HapticPressable>
      </View>

      {/* Search card */}
      <View style={styles.card}>
        <View style={styles.field}>
          <Circle color={c.go} size={11} strokeWidth={3} fill={c.go} />
          <TextInput
            style={styles.input} value={origin}
            onChangeText={(t) => { setOrigin(t); setOriginCoords(null); searchGeo(t, setOriginSug, originTimeoutRef); }}
            placeholder={t('from_pickup')} placeholderTextColor={c.textDisabled}
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
            placeholder={t('to_destination')} placeholderTextColor={c.textDisabled}
          />
        </View>
        <Suggestions items={destSug} onPick={(s) => {
          setDestination(s.place_name); setDestCoords({ lat: s.latitude ?? s.lat ?? 0, lng: s.longitude ?? s.lng ?? 0 }); setDestSug([]);
        }} />

        {/* Why the dropdown is empty — a blank list otherwise reads as a broken
            field, which is exactly how the auth-race 401 presented. */}
        {!!geoError && originSug.length === 0 && destSug.length === 0 && (
          <Text style={styles.geoError}>{geoError}</Text>
        )}

        {/* When. Previously absent entirely: results spanned every future ride,
            so a commute leaving in 20 minutes sat alongside one three weeks
            out. Anytime stays the default so existing behaviour is intact. */}
        <View style={styles.whenPicker}>
          {WHEN_OPTIONS.map((opt) => (
            <HapticPressable
              key={opt.key}
              style={[styles.whenChip, when === opt.key && styles.whenChipOn]}
              onPress={() => setWhen(opt.key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.whenChipText, when === opt.key && styles.whenChipTextOn]}>
                {opt.label}
              </Text>
            </HapticPressable>
          ))}
        </View>

        {/* Seats + Women only */}
        <View style={styles.optRow}>
          <View style={styles.seatBox}>
            <Users color={c.textTertiary} size={15} />
            <HapticPressable onPress={() => setSeats((s) => Math.max(1, s - 1))}><Text style={styles.stepper}>−</Text></HapticPressable>
            <Text style={styles.seatCount}>{seats}</Text>
            <HapticPressable onPress={() => setSeats((s) => Math.min(4, s + 1))}><Text style={styles.stepper}>+</Text></HapticPressable>
          </View>
          <HapticPressable
            style={[styles.womenChip, womenOnly && styles.womenChipOn]}
            onPress={() => setWomenOnly((v) => !v)} activeOpacity={0.85}
          >
            <Venus color={womenOnly ? '#fff' : c.textAccent} size={14} strokeWidth={2.4} />
            <Text style={[styles.womenChipText, womenOnly && { color: '#fff' }]}>{t('women_only')}</Text>
          </HapticPressable>
        </View>

        <HapticPressable style={styles.findBtn} onPress={findRides} disabled={searching} activeOpacity={0.9}>
          {searching ? <ActivityIndicator color={c.actionPrimaryText} />
            : <><Search color={c.actionPrimaryText} size={17} strokeWidth={2.4} /><Text style={styles.findBtnText}>{t('find_rides')}</Text></>}
        </HapticPressable>
      </View>

      {/* Results */}
      {rides !== null && (
        <View style={{ marginTop: space.xl }}>
          {showingCached && (
            <View style={styles.offlineBanner}>
              <Text style={styles.offlineText}>{t('offline_results')}</Text>
            </View>
          )}
          <Text style={styles.sectionTitle}>
            {rides.length > 0 ? t('drivers_on_route')(rides.length) : t('no_matches')}
          </Text>
          {rides.length === 0 && <Text style={styles.muted}>{t('no_matches_hint')}</Text>}
          {rides.map((ride) => (
            <View key={String(ride.id)} style={styles.rideCard}>
              <View style={styles.rideTop}>
                <View style={styles.driverDisc}><Text style={styles.driverDiscText}>{initials(ride.driver_name)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverName}>
                    {ride.driver_name}
                    {(ride as any).driver_rating ? `  ★ ${(ride as any).driver_rating}` : ''}
                  </Text>
                  <View style={styles.vehicleRow}>
                    <VehicleIcon vehicleClass={ride.vehicle_class} />
                    <Text style={styles.vehicle} numberOfLines={1}>
                      {vehicleLabel(ride)}{ride.is_ev ? ' · EV' : ''}{ride.ac_available ? ' · AC' : ''}
                      {(ride as any).driver_rating_count ? ` · ${(ride as any).driver_rating_count} rated trips` : ''}
                    </Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.fare}>{formatMoney(Number(ride.price_split), { decimals: 0 })}</Text>
                  <Text style={styles.perSeat}>per seat</Text>
                </View>
              </View>
              {/* The route itself. Older rides were stored as coordinates
                  only and have no names, so this appears when there is
                  something real to show rather than as an empty arrow. */}
              {(ride.source || ride.destination) && (
                <View style={styles.rideRouteRow}>
                  <MapPin color={c.textSecondary} size={13} strokeWidth={2.4} />
                  <Text style={styles.rideRouteText} numberOfLines={2}>
                    {ride.source || 'Pickup'} → {ride.destination || 'Destination'}
                  </Text>
                </View>
              )}

              {/* When it leaves and how many seats are left were both returned
                  by the API but never shown — riders were choosing between
                  rides, and paying, without either fact. */}
              <View style={styles.whenRow}>
                <Clock
                  color={isDepartingSoon(ride.departure_time) ? c.go : c.textSecondary}
                  size={13}
                  strokeWidth={2.4}
                />
                <Text style={[styles.whenText, isDepartingSoon(ride.departure_time) && styles.whenSoon]}>
                  {formatDeparture(ride.departure_time)}
                </Text>
                {ride.seats_available != null && (
                  <Text style={[styles.seatsLeft, ride.seats_available <= 1 && styles.seatsLow]}>
                    · {ride.seats_available} seat{ride.seats_available === 1 ? '' : 's'} left
                  </Text>
                )}
                {ride.created_at && (
                  <Text style={{ fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginLeft: 'auto' }}>
                    🕒 {formatPostedAgo(ride.created_at)}
                  </Text>
                )}
              </View>

              <View style={styles.badgeRow}>
                {['GOLD', 'SILVER', 'BRONZE'].includes((ride as any).driver_trust_level) && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {(ride as any).driver_trust_level === 'GOLD' ? '🥇 Gold' : (ride as any).driver_trust_level === 'SILVER' ? '🥈 Silver' : '🥉 Bronze'}
                    </Text>
                  </View>
                )}
                {ride.ac_available && <View style={styles.badge}><Wind color={c.info} size={12} strokeWidth={2.4} /><Text style={styles.badgeText}>AC</Text></View>}
                {(ride as any).women_only && <View style={styles.badge}><Venus color={c.textAccent} size={12} strokeWidth={2.4} /><Text style={styles.badgeText}>{t('women_only')}</Text></View>}
                {(ride as any).metro_match && (
                  <View style={[styles.badge, { backgroundColor: c.accentSoft }]}>
                    <Text style={[styles.badgeText, { color: c.textAccent }]}>
                      🏙️ {(ride as any).metro_region || 'Metro match'}
                    </Text>
                  </View>
                )}
                {(ride as any).ride_type === 'INTERCITY' && <View style={styles.badge}><Text style={styles.badgeText}>🛣️ Intercity</Text></View>}
                {(ride as any).ride_type === 'EVENT' && <View style={styles.badge}><Text style={styles.badgeText}>🎪 {(ride as any).event_tag || 'Event'}</Text></View>}
                {ride.pickup_deviation != null && (
                  <Text style={styles.detour}>
                    {ride.pickup_deviation >= 1000
                      ? `${(ride.pickup_deviation / 1000).toFixed(1)}km ${t('detour')}`
                      : `${Math.round(ride.pickup_deviation)}m ${t('detour')}`}
                  </Text>
                )}
              </View>

              {bookedRideIds[String(ride.id)] ? (
                <HapticPressable
                  haptic="tap"
                  style={[styles.bookBtn, { backgroundColor: '#F0FDF4', borderColor: '#86EFAC', borderWidth: 1 }]}
                  onPress={() => router.push(`/trip/${ride.id}`)}
                  activeOpacity={0.9}
                >
                  <Text style={[styles.bookBtnText, { color: '#15803D' }]}>
                    ✓ You booked this ride · View Trip →
                  </Text>
                </HapticPressable>
              ) : (
                <HapticPressable haptic="press" style={styles.bookBtn} onPress={() => bookRide(ride)} activeOpacity={0.9}>
                  <Text style={styles.bookBtnText}>{t('book_ride')} · {formatMoney(Number(ride.price_split), { decimals: 0 })}</Text>
                </HapticPressable>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Frequent routes + CO2 (shown before searching) */}
      {rides === null && (
        <>
          {/* Your actual rides and bookings, replacing two hardcoded rows
              ("Morning commute", "Evening return") that were the same for
              every user and led nowhere. Each row here opens the real thing. */}
          {activity.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Your activity</Text>
              {activity.map((a) => (
                <HapticPressable
                  key={`${a.kind}-${a.id}`}
                  style={styles.routeRow}
                  onPress={() => router.push(a.href as any)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.routeDot, { backgroundColor: a.statusColor }]} />
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.routeTitle} numberOfLines={1}>{a.title}</Text>
                    <Text style={styles.routeSub} numberOfLines={1}>{a.subtitle}</Text>
                  </View>
                  <View style={{
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: radius.pill,
                    backgroundColor: a.statusBg,
                    borderWidth: 1,
                    borderColor: a.statusBorder,
                  }}>
                    <Text style={{ fontFamily: font.sansBold, fontSize: 11, color: a.statusColor }}>
                      {a.statusLabel}
                    </Text>
                  </View>
                </HapticPressable>
              ))}
            </>
          )}
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
  geoError: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginTop: 6, marginBottom: 2 },

  optRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  seatBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surfaceSunken, borderRadius: radius.sm, paddingHorizontal: 12, height: 38, borderWidth: 1, borderColor: c.borderSubtle },
  stepper: { fontFamily: font.sansBold, fontSize: 18, color: c.textSecondary, width: 16, textAlign: 'center' },
  seatCount: { fontFamily: font.monoBold, fontSize: 14, color: c.textPrimary, minWidth: 14, textAlign: 'center' },
  womenChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: brass[300], backgroundColor: c.accentSoft },
  womenChipOn: { backgroundColor: c.textAccent, borderColor: c.textAccent },
  womenChipText: { fontFamily: font.sansSemibold, fontSize: 12.5, color: c.textAccent },

  findBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.actionPrimary, height: 50, borderRadius: radius.md, marginTop: space.md },
  findBtnText: { fontFamily: font.sansBold, fontSize: 15.5, color: c.actionPrimaryText },

  offlineBanner: { backgroundColor: c.accentSoft, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: brass[300] },
  offlineText: { fontFamily: font.sansMedium, fontSize: 12.5, color: c.textAccent, textAlign: 'center' },
  sectionTitle: { fontFamily: font.sansBold, fontSize: 16, color: c.textPrimary, marginBottom: space.md, marginTop: space.lg },
  muted: { fontFamily: font.sans, fontSize: 13, color: c.textTertiary },

  rideCard: { backgroundColor: c.surfaceCard, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: space.md, ...shadowSm },
  rideTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  driverDisc: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: c.surfaceInset, alignItems: 'center', justifyContent: 'center' },
  driverDiscText: { fontFamily: font.sansBold, fontSize: 14, color: c.textSecondary },
  driverName: { fontFamily: font.sansBold, fontSize: 15.5, color: c.textPrimary },
  vehicle: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary, marginTop: 1 },
  fare: { fontFamily: font.monoBold, fontSize: 19, color: c.textPrimary, letterSpacing: -0.4 },
  perSeat: { fontFamily: font.sans, fontSize: 11, color: c.textTertiary },
  whenPicker: { flexDirection: 'row', gap: 6, marginTop: space.md },
  whenChip: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderDefault, alignItems: 'center' },
  whenChipOn: { backgroundColor: c.go, borderColor: c.go },
  whenChipText: { fontFamily: font.sansMedium, fontSize: 12.5, color: c.textSecondary },
  whenChipTextOn: { color: '#fff', fontFamily: font.sansSemibold },
  rideRouteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: space.md },
  rideRouteText: { flex: 1, fontFamily: font.sansSemibold, fontSize: 13, color: c.textPrimary, lineHeight: 18 },
  whenRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md },
  whenText: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textSecondary },
  whenSoon: { color: c.go },
  seatsLeft: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary },
  seatsLow: { color: c.danger, fontFamily: font.sansSemibold },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: space.md },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.surfaceSunken, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontFamily: font.sansSemibold, fontSize: 11, color: c.textSecondary },
  detour: { fontFamily: font.mono, fontSize: 11, color: c.textTertiary, marginLeft: 'auto' },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 },
  bookBtn: { backgroundColor: c.go, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: space.md },
  bookBtnText: { fontFamily: font.sansBold, fontSize: 14.5, color: '#fff' },

  routeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: space.sm },
  routeDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, borderColor: c.accent },
  routeTitle: { fontFamily: font.sansSemibold, fontSize: 14, color: c.textPrimary },
  activityTag: { fontFamily: font.sansSemibold, fontSize: 11, color: c.textTertiary },
  routeSub: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginTop: 1 },

  co2Card: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.goSoft, borderRadius: radius.lg, padding: space.lg, marginTop: space.md },
  co2Icon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  co2Label: { fontFamily: font.sansMedium, fontSize: 12.5, color: c.goStrong },
  co2Value: { fontFamily: font.monoBold, fontSize: 20, color: c.textPrimary, marginTop: 2, letterSpacing: -0.5 },
  co2Unit: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary },
});
