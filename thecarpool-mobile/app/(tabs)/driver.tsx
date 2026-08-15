import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, ScrollView, Dimensions, TextInput, Switch, Alert, ActivityIndicator, Modal, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { PlusCircle, Activity, Navigation, MapPin, Calendar, Users, X, Check, Car, Bike, Shield, Phone, Mail } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { apiFetch } from '../services/api';
import * as haptics from '../services/haptics';
import HapticPressable from '../components/HapticPressable';
import auth from '@react-native-firebase/auth';
import io from 'socket.io-client';
import { API_URL } from '../services/api';
import * as Location from 'expo-location';
import { useAuthStore } from '../store/authStore';

// Departure is picked as a real date AND time. Deliberately built from plain
// chips rather than @react-native-community/datetimepicker: that is a native
// module, so it would force a store build for every change here, while this
// ships over the air.
const DEPARTURE_DAYS = 14;

function upcomingDays(count = DEPARTURE_DAYS): { label: string; date: Date }[] {
  const out: { label: string; date: Date }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    const label =
      i === 0 ? 'Today'
      : i === 1 ? 'Tomorrow'
      : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    out.push({ label, date: d });
  }
  return out;
}

/** Combine a chosen day with an hour/minute into a concrete departure. */
function combineDeparture(day: Date, hour: number, minute: number): Date {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function formatDeparture(d: Date): string {
  return d.toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function Linkedin({ size = 16, color, style }: { size?: number; color?: string; style?: any }) {
  return (
    <View style={[{
      width: size,
      height: size,
      backgroundColor: '#0077b5',
      borderRadius: 3,
      alignItems: 'center',
      justifyContent: 'center',
    }, style]}>
      <Text style={{
        color: '#ffffff',
        fontSize: size * 0.7,
        fontWeight: 'bold',
        lineHeight: size * 0.75,
        textAlign: 'center',
      }}>in</Text>
    </View>
  );
}

const MAX_PICKUP_POINTS = 10;

export default function DriverInterface() {
  const router = useRouter();
  const userId = auth().currentUser?.uid ?? null;
  const [isOnline, setIsOnline] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'drive'>('overview');
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const telemetryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  const originTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (originTimeoutRef.current) clearTimeout(originTimeoutRef.current);
      if (destTimeoutRef.current) clearTimeout(destTimeoutRef.current);
      if (pickupTimeoutRef.current) clearTimeout(pickupTimeoutRef.current);
    };
  }, []);

  // Ride posting form states
  const [showPostModal, setShowPostModal] = useState(false);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [sourceCoords, setSourceCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [sourceSug, setSourceSug] = useState<any[]>([]);
  // Extra stops the driver will collect from, for riders who aren't at the
  // single origin. Stored on the ride and offered to riders at booking.
  const [pickupPoints, setPickupPoints] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [pickupQuery, setPickupQuery] = useState('');
  const [pickupSug, setPickupSug] = useState<any[]>([]);
  const pickupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [destSug, setDestSug] = useState<any[]>([]);
  const [seatsTotal, setSeatsTotal] = useState(3);
  // Departure: a day plus an hour/minute, combined on submit.
  const [depDay, setDepDay] = useState<Date>(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const [depHour, setDepHour] = useState<number>(() => (new Date().getHours() + 1) % 24);
  const [depMinute, setDepMinute] = useState<number>(0);
  const departureAt = combineDeparture(depDay, depHour, depMinute);
  const departureInPast = departureAt.getTime() <= Date.now();
  const [distanceKm, setDistanceKm] = useState('');
  const [vehicleType, setVehicleType] = useState<'CAR' | 'BIKE'>('CAR');
  // Riders see these on the match card before booking, so they know which
  // vehicle they're getting into.
  // Catalogue comes from the server so the driver's pickers and the rider's
  // size icons agree on what each model is.
  const [catalogue, setCatalogue] = useState<{ key: string; label: string; models: { model: string; class: string }[] }[]>([]);
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  // "Other" lets a driver type anything — an unlisted car must never stop
  // someone offering a ride.
  const makeIsOther = vehicleMake === 'Other' || (vehicleMake !== '' && !catalogue.some((m) => m.label === vehicleMake));
  const modelsForMake = catalogue.find((m) => m.label === vehicleMake)?.models ?? [];
  const [vehicleColour, setVehicleColour] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [acAvailable, setAcAvailable] = useState(true);
  const [musicAllowed, setMusicAllowed] = useState(true);
  const [smokingAllowed, setSmokingAllowed] = useState(false);
  const [womenOnlyRide, setWomenOnlyRide] = useState(false);
  // Later-phase modes: daily commute (default), intercity, or event carpooling.
  const [rideType, setRideType] = useState<'COMMUTE' | 'INTERCITY' | 'EVENT'>('COMMUTE');
  const [eventTag, setEventTag] = useState('');
  const [chattiness, setChattiness] = useState<'QUIET' | 'MEDIUM' | 'TALKATIVE'>('MEDIUM');
  const [suggestedPrice, setSuggestedPrice] = useState<number | null>(null);
  const [customPrice, setCustomPrice] = useState('');
  const [activeRideId, setActiveRideId] = useState<string | null>(null);

  // ── Real upcoming rides + passenger manifests (replaces the old mock card) ──
  const [myRides, setMyRides] = useState<any[]>([]);
  const [manifests, setManifests] = useState<Record<string, any>>({});
  const [ridesLoading, setRidesLoading] = useState(false);
  const [earnings, setEarnings] = useState(0);
  const [payoutDestination, setPayoutDestination] = useState<string | null>(null);

  // Real wallet balance and payout destination for the earnings card.
  useEffect(() => {
    if (!userId) return;
    apiFetch(`/api/payments/wallet/${userId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => { if (w) setEarnings(Number(w.available_wallet_balance || 0)); })
      .catch(() => { /* leave at zero rather than invent a number */ });
    apiFetch('/api/payments/payout-method')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.configured) setPayoutDestination(d.destination); })
      .catch(() => {});
  }, [userId]);

  const loadMyRides = async () => {
    setRidesLoading(true);
    try {
      const res = await apiFetch('/api/rides/mine');
      if (!res.ok) { setMyRides([]); return; }
      const all = await res.json();
      const active = (Array.isArray(all) ? all : [])
        .filter((r: any) => r.status === 'SCHEDULED' || r.status === 'STARTED')
        .slice(0, 5);
      setMyRides(active);
      // Fetch each ride's passenger manifest (best-effort).
      const entries = await Promise.all(active.map(async (r: any) => {
        try {
          const m = await apiFetch(`/api/bookings/for-ride/${r.id}`);
          return m.ok ? [r.id, await m.json()] : [r.id, null];
        } catch { return [r.id, null]; }
      }));
      setManifests(Object.fromEntries(entries));
    } catch { setMyRides([]); }
    finally { setRidesLoading(false); }
  };
  useEffect(() => { loadMyRides(); }, []);

  useEffect(() => {
    apiFetch('/api/rides/vehicle-catalogue')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.makes) setCatalogue(d.makes); })
      .catch(() => { /* pickers fall back to free text */ });
  }, []);

  // ── Boarding verification ────────────────────────────────────────────────
  // Each rider reads out a 4-digit code from their trip screen before the
  // driver starts. Rendered as a real modal rather than Alert.prompt, which
  // exists only on iOS — on Android it is a no-op, so drivers could never
  // start a trip at all.
  const [boardingRideId, setBoardingRideId] = useState<string | null>(null);
  const [otpTarget, setOtpTarget] = useState<any | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);

  const closeBoarding = () => {
    setBoardingRideId(null);
    setOtpTarget(null);
    setOtpInput('');
    setOtpBusy(false);
  };

  const boardingPassengers: any[] =
    (boardingRideId && manifests[boardingRideId]?.passengers) || [];

  const commitStart = async (rideId: string) => {
    try {
      const res = await apiFetch(`/api/rides/${rideId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'STARTED' }),
      });
      if (res.ok) {
        haptics.success();
        setActiveRideId(rideId);
        closeBoarding();
        loadMyRides();
        Alert.alert('Trip started', 'Have a safe journey!');
      } else {
        haptics.error();
        const e = await res.json().catch(() => ({}));
        Alert.alert('Could not start', e.message || e.error || `Server error (${res.status}).`);
      }
    } catch {
      haptics.error();
      Alert.alert('Could not start', 'Network error. Please try again.');
    }
  };

  const verifyPassengerOtp = async () => {
    if (!otpTarget) return;
    const code = otpInput.trim();
    if (!/^\d{4}$/.test(code)) {
      haptics.warning();
      Alert.alert('Invalid code', 'Please enter the rider’s 4-digit code.');
      return;
    }
    setOtpBusy(true);
    try {
      const res = await apiFetch(`/api/bookings/${otpTarget.booking_id}/verify-boarding-otp`, {
        method: 'POST',
        body: JSON.stringify({ otp: code }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        haptics.error();
        Alert.alert('Verification failed', data.message || data.error || 'Incorrect boarding code.');
        return;
      }
      haptics.success();
      setOtpInput('');
      setOtpTarget(null);
      await loadMyRides();
    } catch {
      haptics.error();
      Alert.alert('Verification failed', 'Network error. Please try again.');
    } finally {
      setOtpBusy(false);
    }
  };

  // Driver moves the ride through its lifecycle; COMPLETED settles escrow, CANCELLED cancels it.
  const updateRideStatus = (rideId: string, status: 'STARTED' | 'COMPLETED' | 'CANCELLED') => {
    if (status === 'STARTED') {
      const passengers: any[] = manifests[rideId]?.passengers || [];
      if (passengers.length === 0) {
        // Nobody booked — nothing to verify, just confirm.
        Alert.alert('Start this trip?', 'No passengers have booked yet.', [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Start trip', onPress: () => commitStart(rideId) },
        ]);
        return;
      }
      haptics.tap();
      setOtpInput('');
      setOtpTarget(null);
      setBoardingRideId(rideId);
      return;
    }

    if (status === 'CANCELLED') {
      const passengers: any[] = manifests[rideId]?.passengers || [];
      const hasPassengers = passengers.length > 0;
      Alert.alert(
        'Cancel this ride?',
        hasPassengers
          ? 'Passengers who booked will receive full refunds for their seats.'
          : 'Are you sure you want to cancel this offered ride?',
        [
          { text: 'Keep Ride', style: 'cancel' },
          {
            text: 'Yes, Cancel',
            style: 'destructive',
            onPress: async () => {
              try {
                const res = await apiFetch(`/api/rides/${rideId}/status`, {
                  method: 'PATCH',
                  body: JSON.stringify({ status: 'CANCELLED' }),
                });
                if (res.ok) {
                  haptics.warning();
                  setActiveRideId(null);
                  loadMyRides();
                  Alert.alert('Ride Cancelled', 'Your offered ride has been cancelled.');
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
      return;
    }

    // COMPLETED status
    Alert.alert('Complete this trip?', 'Escrow for all passengers is released to your wallet.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Complete trip',
        onPress: async () => {
          try {
            const res = await apiFetch(`/api/rides/${rideId}/status`, {
              method: 'PATCH',
              body: JSON.stringify({ status }),
            });
            if (res.ok) {
              haptics.success();
              setActiveRideId(null);
              loadMyRides();
            } else {
              haptics.error();
              const e = await res.json().catch(() => ({}));
              Alert.alert('Could not update', e.message || e.error || `Server error (${res.status}).`);
            }
          } catch {
            haptics.error();
            Alert.alert('Could not update', 'Network error. Please try again.');
          }
        },
      },
    ]);
  };

  // Haversine distance formula to auto-calculate route length (in KM)
  const calculateHaversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;
    // Add 20% to account for actual road route distance vs straight line
    return Math.round(dist * 1.2 * 10) / 10;
  };

  // Automatically update route length (distanceKm) when source and destination are chosen
  useEffect(() => {
    if (sourceCoords && destCoords) {
      const km = calculateHaversineDistance(
        sourceCoords.lat,
        sourceCoords.lng,
        destCoords.lat,
        destCoords.lng
      );
      if (km > 0) {
        setDistanceKm(km.toString());
      }
    }
  }, [sourceCoords, destCoords]);

  // Calculate suggested pricing on the fly (optional guide only)
  useEffect(() => {
    const dist = parseFloat(distanceKm);
    if (!isNaN(dist) && dist > 0) {
      const baseRate = vehicleType === 'BIKE' ? 6 : 12;
      const acAddon = (vehicleType === 'CAR' && acAvailable) ? 2 : 0;
      const rate = baseRate + acAddon;
      const suggested = Math.round(dist * rate);
      setSuggestedPrice(suggested);
    } else {
      setSuggestedPrice(null);
    }
  }, [distanceKm, vehicleType, acAvailable]);

  // Broadcast the driver's REAL location once a trip is underway, so the rider's
  // map shows where the car actually is.
  //
  // This previously emitted simulated GPS — a hardcoded point in Gurugram that
  // drifted randomly — so riders watched a convincing map of a car that did not
  // exist, and the "driver is arriving" push fired off fake coordinates.
  useEffect(() => {
    // Only while a trip is actually running. Streaming a driver's position
    // outside a live trip would be surveillance, not a feature.
    if (!activeRideId) {
      if (telemetryIntervalRef.current) clearInterval(telemetryIntervalRef.current);
      locationSubRef.current?.remove();
      locationSubRef.current = null;
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    let cancelled = false;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert(
          'Location needed',
          'Your riders track the trip on a map. Enable location access so they can see you on the way.'
        );
        return;
      }

      const token = await auth().currentUser?.getIdToken();
      if (cancelled) return;

      const socket = io(API_URL, { auth: { token } });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('ride:join', activeRideId);
      });

      // Push-based rather than polling: watchPositionAsync fires when the
      // device actually moves, so a stationary car in traffic doesn't burn
      // battery re-sending the same coordinate.
      locationSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 25 },
        (pos) => {
          socketRef.current?.emit('telemetry:update', {
            userId: auth().currentUser?.uid,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: Math.max(0, Math.round((pos.coords.speed ?? 0) * 3.6)), // m/s -> km/h
            bearing: Math.round(pos.coords.heading ?? 0),
            rideId: activeRideId,
          });
        }
      );
      if (cancelled) { locationSubRef.current?.remove(); locationSubRef.current = null; }
    })();

    return () => {
      cancelled = true;
      if (telemetryIntervalRef.current) clearInterval(telemetryIntervalRef.current);
      locationSubRef.current?.remove();
      locationSubRef.current = null;
      socketRef.current?.disconnect();
    };
  }, [activeRideId]);

  const toggleDay = (dayIndex: number) => {
    if (selectedDays.includes(dayIndex)) {
      setSelectedDays(selectedDays.filter(d => d !== dayIndex));
    } else {
      setSelectedDays([...selectedDays, dayIndex]);
    }
  };

  const searchGeo = async (q: string, setSuggestions: (s: any[]) => void, timeoutRef: React.MutableRefObject<any>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (q.trim().length < 3) { setSuggestions([]); return; }

    timeoutRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/geo/search?query=${encodeURIComponent(q)}`);
        if (!res.ok) { setSuggestions([]); return; }
        const data = await res.json();
        setSuggestions(data.results || data.suggestions || (Array.isArray(data) ? data : []));
      } catch {
        setSuggestions([]);
      }
    }, 300);
  };

  const handlePostRide = async () => {
    if (!sourceCoords || !destCoords) {
      Alert.alert('Select Locations', 'Pick a pickup and destination from the suggestions.');
      return;
    }
    if (departureInPast) {
      Alert.alert('Pick a future time', 'That departure time has already passed.');
      return;
    }
    const price = parseFloat(customPrice);
    if (!price || isNaN(price) || price <= 0) {
      Alert.alert('Set a Price', 'Please enter your requested price per seat before posting.');
      return;
    }
    setIsPosting(true);
    try {
      // GeoJSON LineString coordinates are [lng, lat] pairs.
      const route_geojson = {
        type: 'LineString',
        coordinates: [
          [sourceCoords.lng, sourceCoords.lat],
          [destCoords.lng, destCoords.lat],
        ],
      };
      const res = await apiFetch('/api/rides', {
        method: 'POST',
        body: JSON.stringify({
          driver_id: userId,
          route_geojson,
          seats_total: seatsTotal,
          price_split: price,
          departure_time: departureAt.toISOString(),
          vehicle_type: vehicleType,
          vehicle_make: vehicleMake.trim(),
          vehicle_model: vehicleModel.trim(),
          vehicle_colour: vehicleColour.trim(),
          vehicle_plate: vehiclePlate.trim(),
          pickup_points: pickupPoints,
          // Derived from source/destination. The backend prices the optional
          // journey insurance from this; omitting it made insurance invisible.
          distance_km: parseFloat(distanceKm) || undefined,
          ac_available: acAvailable,
          music_allowed: musicAllowed,
          smoking_allowed: smokingAllowed,
          chattiness,
          women_only: womenOnlyRide,
          ride_type: rideType,
          ...(rideType === 'EVENT' && eventTag.trim() ? { event_tag: eventTag.trim() } : {}),
          is_recurring: isRecurring,
          recurring_days: isRecurring ? selectedDays : [],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Alert.alert('Failed to Post Ride', err.message || err.error || `Server error ${res.status}`);
        return;
      }
      const ride = await res.json();
      haptics.success(); // route published
      setActiveRideId(String(ride.id || ride.ride_id));
      setShowPostModal(false);
      Alert.alert(
        'Ride Posted! 🚗',
        `Your commute is live. Ride #${ride.id || ride.ride_id}. Go Online to start broadcasting your location.`,
        [{ text: 'OK' }]
      );
    } catch {
      Alert.alert('Network Error', 'Could not reach the server. Check your connection.');
    } finally {
      setIsPosting(false);
    }
  };

  // Unlocked Driver State
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Driver Dashboard</Text>
        <HapticPressable 
          style={[styles.onlineToggle, isOnline ? styles.onlineActive : styles.onlineInactive]}
          onPress={() => setIsOnline(!isOnline)}
        >
          <View style={[styles.onlineDot, isOnline ? { backgroundColor: 'white' } : { backgroundColor: colors.textMuted }]} />
          <Text style={[styles.onlineText, isOnline ? { color: 'white' } : { color: colors.textMuted }]}>
            {isOnline ? 'Online' : 'Go Online'}
          </Text>
        </HapticPressable>
      </View>

      {/* Top Segmented Control */}
      <View style={styles.segmentedControl}>
        <HapticPressable style={[styles.segmentBtn, activeTab === 'overview' && styles.segmentActive]} onPress={() => setActiveTab('overview')}>
          <Text style={[styles.segmentText, activeTab === 'overview' && styles.segmentTextActive]}>Overview</Text>
        </HapticPressable>
        <HapticPressable style={[styles.segmentBtn, activeTab === 'requests' && styles.segmentActive]} onPress={() => setActiveTab('requests')}>
          <Text style={[styles.segmentText, activeTab === 'requests' && styles.segmentTextActive]}>Requests (2)</Text>
        </HapticPressable>
        <HapticPressable style={[styles.segmentBtn, activeTab === 'drive' && styles.segmentActive]} onPress={() => setActiveTab('drive')}>
          <Text style={[styles.segmentText, activeTab === 'drive' && styles.segmentTextActive]}>Drive</Text>
        </HapticPressable>
      </View>

      <View style={styles.content}>
        {activeTab === 'overview' && !showPostModal && (
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Earnings. Real balance from the wallet — this used to show a
                hardcoded ₹4,320 and "+12% from last week" to every driver. */}
            <View style={styles.earningsCard}>
              <Text style={styles.earningsLabel}>Your earnings</Text>
              <Text style={styles.earningsAmount}>₹{earnings.toLocaleString('en-IN')}</Text>
              <HapticPressable haptic="press" style={styles.sparklineBox} onPress={() => router.push('/payout-method')}>
                <Activity color={colors.success} size={20} />
                <Text style={styles.sparklineText}>
                  {payoutDestination
                    ? `Paid to ${payoutDestination} after each ride →`
                    : 'Add bank or UPI details to get paid →'}
                </Text>
              </HapticPressable>
            </View>

            <HapticPressable haptic="press" style={styles.postRideBtn} onPress={() => setShowPostModal(true)}>
              <PlusCircle color="white" size={20} />
              <Text style={styles.postRideText}>Offer a New Ride</Text>
            </HapticPressable>

            <Text style={styles.sectionTitle}>My Upcoming Rides</Text>

            {ridesLoading && myRides.length === 0 && <ActivityIndicator color={colors.success} style={{ marginTop: 12 }} />}
            {!ridesLoading && myRides.length === 0 && (
              <Text style={styles.noRidesText}>No active rides. Offer a ride to start earning.</Text>
            )}
            {myRides.map((r) => {
              const m = manifests[r.id];
              const seatsFilled = m ? m.seats_booked : (r.seats_total - r.seats_available);
              const dep = new Date(r.departure_time);
              return (
                <View key={r.id} style={styles.upcomingCard}>
                  <View style={styles.routeBox}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={styles.routeTime}>
                        {dep.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {dep.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                      <View style={styles.badgeRow}>
                        <Text style={styles.miniBadge}>{r.vehicle_type || 'CAR'}</Text>
                        {r.status === 'STARTED' && <Text style={[styles.miniBadge, { color: colors.success }]}>LIVE</Text>}
                        {r.women_only && <Text style={styles.miniBadge}>♀ WOMEN</Text>}
                      </View>
                    </View>
                    <Text style={styles.routeDest}>Ride #{String(r.id).replace('ride_', '').slice(0, 8)} · ₹{Number(r.price_split).toFixed(0)}/seat</Text>
                  </View>

                  {/* Passenger manifest with contact options */}
                  <View style={styles.passengerBox}>
                    <View style={{ flex: 1 }}>
                      {m && m.passengers.length > 0 ? (
                        m.passengers.map((p: any) => (
                          <View key={p.booking_id} style={styles.passengerRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.manifestRow}>
                                {p.rider_name}{p.rider_rating ? ` ★${p.rider_rating}` : ''} · {p.seats_booked} seat{p.seats_booked > 1 ? 's' : ''}
                              </Text>
                              {p.rider_phone && (
                                <Text style={styles.passengerPhoneText}>📞 {p.rider_phone}</Text>
                              )}
                            </View>
                            <View style={styles.passengerContactIcons}>
                              {p.rider_phone && (
                                <HapticPressable
                                  haptic="tap"
                                  style={styles.passengerContactBtn}
                                  onPress={() => Linking.openURL(`tel:${p.rider_phone}`)}
                                  accessibilityLabel={`Call ${p.rider_name}`}
                                >
                                  <Phone color={colors.success} size={15} />
                                </HapticPressable>
                              )}
                              {p.rider_email && (
                                <HapticPressable
                                  haptic="tap"
                                  style={styles.passengerContactBtn}
                                  onPress={() => Linking.openURL(`mailto:${p.rider_email}`)}
                                  accessibilityLabel={`Email ${p.rider_name}`}
                                >
                                  <Mail color={colors.primary} size={15} />
                                </HapticPressable>
                              )}
                            </View>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.manifestRow}>No bookings yet</Text>
                      )}
                    </View>
                    <Text style={styles.seatText}>{seatsFilled}/{r.seats_total} Seats Filled</Text>
                  </View>

                  {/* Lifecycle controls */}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    {r.status === 'SCHEDULED' && (
                      <>
                        <HapticPressable haptic="press" style={styles.startBtn} onPress={() => updateRideStatus(r.id, 'STARTED')} activeOpacity={0.9}>
                          <Text style={styles.startBtnText}>▶ Start trip</Text>
                        </HapticPressable>
                        <HapticPressable haptic="warning" style={styles.cancelRideBtn} onPress={() => updateRideStatus(r.id, 'CANCELLED')} activeOpacity={0.9}>
                          <Text style={styles.cancelRideBtnText}>✕ Cancel</Text>
                        </HapticPressable>
                      </>
                    )}
                    {r.status === 'STARTED' && (
                      <HapticPressable haptic="press" style={styles.completeBtn} onPress={() => updateRideStatus(r.id, 'COMPLETED')} activeOpacity={0.9}>
                        <Text style={styles.startBtnText}>✓ Complete trip · release escrow</Text>
                      </HapticPressable>
                    )}
                    <HapticPressable style={styles.chatMiniBtn} onPress={() => router.push(`/chat/${r.id}`)} activeOpacity={0.9}>
                      <Text style={styles.chatMiniText}>💬</Text>
                    </HapticPressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Post a New Ride Form Drawer (Togopool & BlaBlaCar Gaps) */}
        {activeTab === 'overview' && showPostModal && (
          <ScrollView showsVerticalScrollIndicator={false} style={styles.formContainer}>
            <View style={styles.formHeader}>
              <Text style={styles.formTitle}>Offer Commute Details</Text>
              <HapticPressable onPress={() => setShowPostModal(false)}>
                <X color={colors.textMuted} size={24} />
              </HapticPressable>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Pickup (source)</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Where do you start from?"
                placeholderTextColor={colors.inputPlaceholder}
                value={source}
                onChangeText={(t) => { setSource(t); setSourceCoords(null); searchGeo(t, setSourceSug, originTimeoutRef); }}
              />
              {sourceSug.length > 0 && (
                <View style={styles.suggBox}>
                  {sourceSug.slice(0, 5).map((s, i) => (
                    <HapticPressable key={i} style={styles.suggItem} onPress={() => {
                      setSource(`${s.place_name}${s.postal_code ? ` (${s.postal_code})` : ''}`);
                      setSourceCoords({ lat: s.latitude ?? s.lat ?? 0, lng: s.longitude ?? s.lng ?? 0 });
                      setSourceSug([]);
                    }}>
                      <Text style={styles.suggText} numberOfLines={1}>{s.place_name}{s.state_name ? `, ${s.state_name}` : ''}</Text>
                    </HapticPressable>
                  ))}
                </View>
              )}
            </View>

            {/* Extra pickup points — riders aren't always at the origin */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Pickup points (optional)</Text>
              <Text style={styles.formHint}>
                Add stops along your route where you're happy to collect riders.
                They pick one when booking. Up to {MAX_PICKUP_POINTS}.
              </Text>

              {pickupPoints.map((pt, i) => (
                <View key={`${pt.lat},${pt.lng},${i}`} style={styles.pickupRow}>
                  <MapPin color={colors.primary} size={16} />
                  <Text style={styles.pickupLabel} numberOfLines={1}>{pt.label}</Text>
                  <HapticPressable
                    haptic="warning"
                    onPress={() => setPickupPoints((prev) => prev.filter((_, j) => j !== i))}
                    accessibilityLabel={`Remove ${pt.label}`}
                  >
                    <X color={colors.textMuted} size={16} />
                  </HapticPressable>
                </View>
              ))}

              {pickupPoints.length < MAX_PICKUP_POINTS && (
                <>
                  <TextInput
                    style={styles.formInput}
                    placeholder="Add a pickup stop"
                    placeholderTextColor={colors.inputPlaceholder}
                    value={pickupQuery}
                    onChangeText={(t) => { setPickupQuery(t); searchGeo(t, setPickupSug, pickupTimeoutRef); }}
                  />
                  {pickupSug.length > 0 && (
                    <View style={styles.suggBox}>
                      {pickupSug.slice(0, 5).map((sg, i) => (
                        <HapticPressable key={i} style={styles.suggItem} onPress={() => {
                          const lat = sg.latitude ?? sg.lat ?? 0;
                          const lng = sg.longitude ?? sg.lng ?? 0;
                          if (!lat && !lng) return;
                          setPickupPoints((prev) => (
                            prev.length >= MAX_PICKUP_POINTS ? prev : [...prev, { label: sg.place_name, lat, lng }]
                          ));
                          setPickupQuery('');
                          setPickupSug([]);
                        }}>
                          <Text style={styles.suggText} numberOfLines={1}>
                            {sg.place_name}{sg.state_name ? `, ${sg.state_name}` : ''}
                          </Text>
                        </HapticPressable>
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Office Destination</Text>
              <TextInput
                style={styles.formInput}
                placeholder="e.g. DLF Cyber City Building 10"
                placeholderTextColor={colors.inputPlaceholder}
                value={destination}
                onChangeText={(t) => { setDestination(t); setDestCoords(null); searchGeo(t, setDestSug, destTimeoutRef); }}
              />
              {destSug.length > 0 && (
                <View style={styles.suggBox}>
                  {destSug.slice(0, 5).map((s, i) => (
                    <HapticPressable key={i} style={styles.suggItem} onPress={() => {
                      setDestination(`${s.place_name}${s.postal_code ? ` (${s.postal_code})` : ''}`);
                      setDestCoords({ lat: s.latitude ?? s.lat ?? 0, lng: s.longitude ?? s.lng ?? 0 });
                      setDestSug([]);
                    }}>
                      <Text style={styles.suggText} numberOfLines={1}>{s.place_name}{s.state_name ? `, ${s.state_name}` : ''}</Text>
                    </HapticPressable>
                  ))}
                </View>
              )}
            </View>

            {/* Route length is derived from source + destination, not typed.
                Asking for it again invited a number that disagreed with the
                route, and it drives both smart pricing and insurance. */}
            {distanceKm !== '' && (
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Route length</Text>
                <Text style={styles.derivedValue}>{distanceKm} km</Text>
                <Text style={styles.formHint}>Measured from your start and destination.</Text>
              </View>
            )}

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Seats Offered</Text>
              <View style={styles.seatRow}>
                <HapticPressable
                  style={[styles.seatBtn, seatsTotal <= 1 && styles.seatBtnDisabled]}
                  onPress={() => setSeatsTotal((s) => Math.max(1, s - 1))}
                  disabled={seatsTotal <= 1}
                >
                  <Text style={styles.seatBtnText}>−</Text>
                </HapticPressable>
                <Text style={styles.seatCount}>{seatsTotal}</Text>
                <HapticPressable
                  style={[styles.seatBtn, seatsTotal >= 6 && styles.seatBtnDisabled]}
                  onPress={() => setSeatsTotal((s) => Math.min(6, s + 1))}
                  disabled={seatsTotal >= 6}
                >
                  <Text style={styles.seatBtnText}>+</Text>
                </HapticPressable>
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Departure</Text>
              <Text style={styles.formHint}>Pick the day, then the time you'll set off.</Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {upcomingDays().map((d) => {
                  const active = d.date.toDateString() === depDay.toDateString();
                  return (
                    <HapticPressable
                      key={d.label}
                      style={[styles.depChip, active && styles.depChipActive]}
                      onPress={() => setDepDay(d.date)}
                    >
                      <Text style={[styles.depChipText, active && styles.depChipTextActive]}>{d.label}</Text>
                    </HapticPressable>
                  );
                })}
              </ScrollView>

              <Text style={styles.formSubLabel}>Hour</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {Array.from({ length: 24 }, (_, h) => h).map((h) => {
                  const active = h === depHour;
                  const label = `${((h % 12) || 12)}${h < 12 ? 'am' : 'pm'}`;
                  return (
                    <HapticPressable
                      key={h}
                      style={[styles.depChip, active && styles.depChipActive]}
                      onPress={() => setDepHour(h)}
                    >
                      <Text style={[styles.depChipText, active && styles.depChipTextActive]}>{label}</Text>
                    </HapticPressable>
                  );
                })}
              </ScrollView>

              <Text style={styles.formSubLabel}>Minutes</Text>
              <View style={styles.depRow}>
                {[0, 15, 30, 45].map((m) => {
                  const active = m === depMinute;
                  return (
                    <HapticPressable
                      key={m}
                      style={[styles.depChip, active && styles.depChipActive]}
                      onPress={() => setDepMinute(m)}
                    >
                      <Text style={[styles.depChipText, active && styles.depChipTextActive]}>
                        :{String(m).padStart(2, '0')}
                      </Text>
                    </HapticPressable>
                  );
                })}
              </View>

              <Text style={[styles.depSummary, departureInPast && styles.depSummaryBad]}>
                {departureInPast
                  ? `${formatDeparture(departureAt)} is in the past — pick a later time.`
                  : `Departing ${formatDeparture(departureAt)}`}
              </Text>
            </View>

            {/* Vehicle Mode (Togopool Bike vs Car Option Gap) */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Vehicle Mode</Text>
              <View style={styles.vehicleSelectRow}>
                <HapticPressable 
                  style={[styles.vehicleSelectBtn, vehicleType === 'CAR' && styles.vehicleSelectBtnActive]}
                  onPress={() => setVehicleType('CAR')}
                >
                  <Car color={vehicleType === 'CAR' ? '#fff' : colors.textMuted} size={18} style={{marginRight: 6}} />
                  <Text style={[styles.vehicleSelectBtnText, vehicleType === 'CAR' && styles.vehicleSelectBtnTextActive]}>Car Pool</Text>
                </HapticPressable>
                <HapticPressable 
                  style={[styles.vehicleSelectBtn, vehicleType === 'BIKE' && styles.vehicleSelectBtnActive]}
                  onPress={() => setVehicleType('BIKE')}
                >
                  <Bike color={vehicleType === 'BIKE' ? '#fff' : colors.textMuted} size={18} style={{marginRight: 6}} />
                  <Text style={[styles.vehicleSelectBtnText, vehicleType === 'BIKE' && styles.vehicleSelectBtnTextActive]}>Bike Pool</Text>
                </HapticPressable>
              </View>
            </View>

            {/* Vehicle details — surfaced to riders on the match card */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>
                {vehicleType === 'BIKE' ? 'Bike details' : 'Car details'}
              </Text>
              <Text style={styles.formHint}>
                Riders see this before booking, so they know which vehicle to look for.
              </Text>
              <Text style={styles.formSubLabel}>Make</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {catalogue.map((m) => {
                  const active = vehicleMake === m.label;
                  return (
                    <HapticPressable
                      key={m.key}
                      style={[styles.depChip, active && styles.depChipActive]}
                      onPress={() => { setVehicleMake(m.label); setVehicleModel(''); }}
                    >
                      <Text style={[styles.depChipText, active && styles.depChipTextActive]}>{m.label}</Text>
                    </HapticPressable>
                  );
                })}
              </ScrollView>

              {makeIsOther ? (
                <TextInput
                  style={styles.formInput}
                  placeholder={vehicleType === 'BIKE' ? 'Type the make (e.g. Yamaha)' : 'Type the make (e.g. Rivian)'}
                  placeholderTextColor={colors.inputPlaceholder}
                  value={vehicleMake === 'Other' ? '' : vehicleMake}
                  onChangeText={setVehicleMake}
                  maxLength={40}
                />
              ) : null}

              {vehicleMake !== '' && (
                <>
                  <Text style={styles.formSubLabel}>Model</Text>
                  {modelsForMake.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                      {modelsForMake.map((mm) => {
                        const active = vehicleModel === mm.model;
                        return (
                          <HapticPressable
                            key={mm.model}
                            style={[styles.depChip, active && styles.depChipActive]}
                            onPress={() => setVehicleModel(mm.model)}
                          >
                            <Text style={[styles.depChipText, active && styles.depChipTextActive]}>{mm.model}</Text>
                          </HapticPressable>
                        );
                      })}
                    </ScrollView>
                  )}
                  <TextInput
                    style={styles.formInput}
                    placeholder={modelsForMake.length ? "Not listed? Type your model" : 'Type your model'}
                    placeholderTextColor={colors.inputPlaceholder}
                    value={vehicleModel}
                    onChangeText={setVehicleModel}
                    maxLength={40}
                  />
                </>
              )}
              <View style={styles.vehicleDetailRow}>
                <TextInput
                  style={[styles.formInput, { flex: 1 }]}
                  placeholder="Colour (e.g. White)"
                  placeholderTextColor={colors.inputPlaceholder}
                  value={vehicleColour}
                  onChangeText={setVehicleColour}
                  maxLength={40}
                />
                <TextInput
                  style={[styles.formInput, { flex: 1 }]}
                  placeholder="Number plate"
                  placeholderTextColor={colors.inputPlaceholder}
                  value={vehiclePlate}
                  onChangeText={(t) => setVehiclePlate(t.toUpperCase())}
                  autoCapitalize="characters"
                  maxLength={20}
                />
              </View>
            </View>

            {/* Pricing: Driver decides their own price per seat */}
            <View style={styles.pricingCard}>
              <Text style={styles.pricingTitle}>Your price per seat</Text>
              <Text style={styles.pricingSub}>
                Enter the amount you would like each passenger to contribute for this ride.
              </Text>
              <View style={styles.priceInputGroup}>
                <Text style={styles.priceInputLabel}>Price per seat (₹):</Text>
                <TextInput
                  style={styles.priceInput}
                  keyboardType="numeric"
                  value={customPrice}
                  onChangeText={(t) => setCustomPrice(t.replace(/[^0-9.]/g, ''))}
                  placeholder="e.g. 150"
                  placeholderTextColor={colors.inputPlaceholder}
                />
              </View>
              {suggestedPrice !== null && (
                <HapticPressable onPress={() => setCustomPrice(String(Math.round(suggestedPrice)))}>
                  <Text style={styles.useSuggested}>💡 Suggestion: ₹{suggestedPrice.toFixed(0)} (tap to use)</Text>
                </HapticPressable>
              )}
            </View>

            {/* Recurring Schedules (Quick Ride "Repeat Ride" Gap) */}
            <View style={styles.formSwitchRow}>
              <View>
                <Text style={styles.formLabel}>Recurring Office Commute</Text>
                <Text style={styles.formSubLabel}>Automate booking for daily schedules</Text>
              </View>
              <Switch 
                value={isRecurring}
                onValueChange={setIsRecurring}
                trackColor={{ false: colors.cardBorder, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            {isRecurring && (
              <View style={styles.daysContainer}>
                {['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'].map((day, idx) => {
                  const active = selectedDays.includes(idx);
                  return (
                    <HapticPressable 
                      key={day} 
                      style={[styles.dayChip, active && styles.dayChipActive]}
                      onPress={() => toggleDay(idx)}
                    >
                      <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>{day}</Text>
                    </HapticPressable>
                  );
                })}
              </View>
            )}

            {/* Granular Driver Preferences (Togopool Granular Prefs Gap) */}
            <Text style={styles.formSectionTitle}>Granular Preferences</Text>
            
            {vehicleType === 'CAR' && (
              <View style={styles.prefSwitchRow}>
                <Text style={styles.prefLabel}>AC Available</Text>
                <Switch 
                  value={acAvailable} 
                  onValueChange={setAcAvailable}
                  trackColor={{ false: colors.cardBorder, true: colors.success }}
                />
              </View>
            )}

            <View style={styles.prefSwitchRow}>
              <Text style={styles.prefLabel}>Music Allowed</Text>
              <Switch 
                value={musicAllowed} 
                onValueChange={setMusicAllowed}
                trackColor={{ false: colors.cardBorder, true: colors.success }}
              />
            </View>

            <View style={styles.prefSwitchRow}>
              <Text style={styles.prefLabel}>Smoking Allowed</Text>
              <Switch
                value={smokingAllowed}
                onValueChange={setSmokingAllowed}
                trackColor={{ false: colors.cardBorder, true: colors.success }}
              />
            </View>

            <View style={styles.prefSwitchRow}>
              <Text style={styles.prefLabel}>♀ Women-only ride</Text>
              <Switch
                value={womenOnlyRide}
                onValueChange={setWomenOnlyRide}
                trackColor={{ false: colors.cardBorder, true: colors.success }}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Ride Type</Text>
              <View style={styles.chatSelectRow}>
                {(['COMMUTE', 'INTERCITY', 'EVENT'] as const).map(mode => {
                  const active = rideType === mode;
                  return (
                    <HapticPressable
                      key={mode}
                      style={[styles.chatBtn, active && styles.chatBtnActive]}
                      onPress={() => setRideType(mode)}
                    >
                      <Text style={[styles.chatBtnText, active && styles.chatBtnTextActive]}>
                        {mode === 'COMMUTE' ? 'Commute' : mode === 'INTERCITY' ? 'Intercity' : 'Event'}
                      </Text>
                    </HapticPressable>
                  );
                })}
              </View>
              {rideType === 'EVENT' && (
                <TextInput
                  style={styles.formInput}
                  placeholder='Event tag, e.g. "sunburn-2026"'
                  placeholderTextColor="#6b7280"
                  value={eventTag}
                  onChangeText={setEventTag}
                  autoCapitalize="none"
                />
              )}
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Chattiness Level</Text>
              <View style={styles.chatSelectRow}>
                {(['QUIET', 'MEDIUM', 'TALKATIVE'] as const).map(level => {
                  const active = chattiness === level;
                  return (
                    <HapticPressable 
                      key={level} 
                      style={[styles.chatBtn, active && styles.chatBtnActive]}
                      onPress={() => setChattiness(level)}
                    >
                      <Text style={[styles.chatBtnText, active && styles.chatBtnTextActive]}>{level}</Text>
                    </HapticPressable>
                  );
                })}
              </View>
            </View>

            <HapticPressable haptic="press" style={styles.submitBtn} onPress={handlePostRide}>
              <Text style={styles.submitBtnText}>Post Commute Route</Text>
            </HapticPressable>
          </ScrollView>
        )}

        {/* Requests Tab (sRide Social Trust display gap) */}
        {activeTab === 'requests' && (
          <ScrollView showsVerticalScrollIndicator={false}>
            {[
              { name: 'Amit Sharma', rating: '4.8', linkedin: true, connections: 184, route: 'IFFCO Chowk → Ambience Mall' },
              { name: 'Priya Sen', rating: '4.9', linkedin: true, connections: 250, route: 'Sector 56 → DLF Cyber City' }
            ].map((req, i) => (
              <View key={i} style={styles.requestCard}>
                <View style={styles.reqHeader}>
                  <View style={styles.reqAvatar} />
                  <View style={{flex: 1}}>
                    <Text style={styles.reqName}>{req.name}</Text>
                    <Text style={styles.reqRating}>★ {req.rating}</Text>
                  </View>
                </View>

                {req.linkedin && (
                  <View style={styles.reqLinkedinBadge}>
                    <Linkedin size={12} color="#0077b5" style={{marginRight: 4}} />
                    <Text style={styles.reqLinkedinText}>LinkedIn: {req.connections}+ connections</Text>
                  </View>
                )}

                <View style={styles.reqRoute}>
                  <Text style={styles.reqRouteText}>{req.route}</Text>
                </View>
                <View style={styles.actionRow}>
                  <HapticPressable style={styles.declineBtn}><X color="#ef4444" size={24} /></HapticPressable>
                  <HapticPressable style={styles.acceptBtn}><Check color="#fff" size={24} /><Text style={styles.acceptText}>Accept Rider</Text></HapticPressable>
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {activeTab === 'drive' && (
          <View style={styles.driveContainer}>
            <View style={styles.driveHeader}>
              <Navigation color={colors.success} size={28} />
              <Text style={styles.driveTitle}>Navigating to Amit</Text>
              <Text style={styles.driveEta}>4 mins away</Text>
            </View>

            <View style={styles.stopList}>
              <View style={styles.stopItemActive}>
                <Text style={styles.stopLabel}>NEXT STOP</Text>
                <Text style={styles.stopLocation}>Pickup: Amit (IFFCO Chowk)</Text>
              </View>
              <View style={styles.stopItem}>
                <Text style={styles.stopLocation}>Pickup: Priya (Phase 3)</Text>
              </View>
              <View style={styles.stopItem}>
                <Text style={styles.stopLocation}>Drop: Amit (Ambience Mall)</Text>
              </View>
            </View>

            <HapticPressable haptic="press" style={styles.hugeActionBtn}>
              <Text style={styles.hugeActionText}>Passenger Picked Up</Text>
            </HapticPressable>
          </View>
        )}
      </View>

      {/* Boarding verification — cross-platform (Alert.prompt is iOS-only) */}
      <Modal
        visible={boardingRideId !== null}
        transparent
        animationType="fade"
        onRequestClose={closeBoarding}
      >
        <View style={styles.otpBackdrop}>
          <View style={styles.otpSheet}>
            <View style={styles.otpHeader}>
              <Text style={styles.otpTitle}>Verify boarding</Text>
              <HapticPressable onPress={closeBoarding} accessibilityLabel="Close">
                <X color={colors.textMuted} size={22} />
              </HapticPressable>
            </View>

            {otpTarget ? (
              <>
                <Text style={styles.otpSub}>
                  Ask {otpTarget.rider_name} for the 4-digit code on their trip screen.
                </Text>
                <TextInput
                  style={styles.otpInput}
                  value={otpInput}
                  onChangeText={(t) => setOtpInput(t.replace(/\D/g, '').slice(0, 4))}
                  keyboardType="number-pad"
                  maxLength={4}
                  autoFocus
                  placeholder="––––"
                  placeholderTextColor={colors.textMuted}
                  editable={!otpBusy}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <HapticPressable
                    style={[styles.otpGhostBtn, { flex: 1 }]}
                    onPress={() => { setOtpTarget(null); setOtpInput(''); }}
                    disabled={otpBusy}
                  >
                    <Text style={styles.otpGhostText}>Back</Text>
                  </HapticPressable>
                  <HapticPressable
                    haptic="press"
                    style={[styles.otpPrimaryBtn, { flex: 2 }, otpBusy && { opacity: 0.6 }]}
                    onPress={verifyPassengerOtp}
                    disabled={otpBusy}
                  >
                    {otpBusy
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.otpPrimaryText}>Verify</Text>}
                  </HapticPressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.otpSub}>
                  Confirm each rider is in the vehicle before you start.
                </Text>
                {boardingPassengers.map((p) => (
                  <View key={p.booking_id} style={styles.otpRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.otpRowName}>{p.rider_name}</Text>
                      <Text style={styles.otpRowMeta}>
                        {p.seats_booked} seat{p.seats_booked > 1 ? 's' : ''}
                      </Text>
                    </View>
                    {p.boarding_verified ? (
                      <Text style={styles.otpVerified}>✓ Verified</Text>
                    ) : (
                      <HapticPressable
                        style={styles.otpVerifyBtn}
                        onPress={() => { setOtpInput(''); setOtpTarget(p); }}
                      >
                        <Text style={styles.otpVerifyText}>Verify</Text>
                      </HapticPressable>
                    )}
                  </View>
                ))}

                <HapticPressable
                  haptic="press"
                  style={styles.otpPrimaryBtn}
                  onPress={() => {
                    const pending = boardingPassengers.filter((p) => !p.boarding_verified);
                    if (pending.length === 0) {
                      commitStart(boardingRideId!);
                      return;
                    }
                    Alert.alert(
                      'Start without verifying?',
                      `${pending.length} rider${pending.length > 1 ? 's have' : ' has'} not been verified. You can still start, but boarding won't be confirmed for them.`,
                      [
                        { text: 'Keep verifying', style: 'cancel' },
                        { text: 'Start anyway', style: 'destructive', onPress: () => commitStart(boardingRideId!) },
                      ]
                    );
                  }}
                >
                  <Text style={styles.otpPrimaryText}>Start trip</Text>
                </HapticPressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 50 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 },
  headerTitle: { fontSize: 24, fontWeight: '900', color: colors.text },
  
  onlineToggle: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, gap: 6, borderWidth: 1 },
  onlineActive: { backgroundColor: colors.success, borderColor: colors.success },
  onlineInactive: { backgroundColor: colors.inputBackground, borderColor: colors.cardBorder },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  onlineText: { fontWeight: 'bold', fontSize: 12 },

  segmentedControl: { flexDirection: 'row', backgroundColor: colors.inputBackground, marginHorizontal: 20, borderRadius: 12, padding: 4, marginBottom: 20, borderWidth: 1, borderColor: colors.cardBorder },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  segmentActive: { backgroundColor: colors.card, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4 },
  segmentText: { fontWeight: '600', color: colors.textMuted },
  segmentTextActive: { color: colors.text, fontWeight: 'bold' },

  content: { flex: 1, paddingHorizontal: 20 },

  earningsCard: { backgroundColor: colors.inputBackground, padding: 24, borderRadius: 24, marginBottom: 20, borderWidth: 1, borderColor: colors.cardBorder },
  earningsLabel: { color: colors.textMuted, fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase' },
  earningsAmount: { fontSize: 40, fontWeight: '900', color: colors.text, marginVertical: 8 },
  sparklineBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(16,185,129,0.15)', padding: 8, borderRadius: 8, alignSelf: 'flex-start' },
  sparklineText: { color: colors.success, fontWeight: 'bold', fontSize: 12 },

  postRideBtn: { backgroundColor: colors.primary, padding: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 32 },
  postRideText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: colors.text, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  upcomingCard: { backgroundColor: colors.inputBackground, borderRadius: 20, padding: 16, borderLeftWidth: 4, borderLeftColor: colors.primary, borderWidth: 1, borderColor: colors.cardBorder },
  routeBox: { marginBottom: 16 },
  routeTime: { color: colors.primary, fontWeight: 'bold', marginBottom: 4 },
  routeDest: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  noRidesText: { color: colors.textMuted, fontSize: 13, marginTop: 8 },
  manifestRow: { color: colors.textMuted, fontSize: 12, marginBottom: 2 },
  passengerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  passengerPhoneText: { color: colors.success, fontSize: 11, fontWeight: '600', marginTop: 1 },
  passengerContactIcons: { flexDirection: 'row', gap: 6, marginLeft: 8 },
  passengerContactBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center' },

  // Boarding verification modal
  otpBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 20 },
  otpSheet: { backgroundColor: colors.card, borderRadius: 16, padding: 18 },
  otpHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  otpTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  otpSub: { color: colors.textMuted, fontSize: 13, marginBottom: 14 },
  otpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  otpRowName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  otpRowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  otpVerified: { color: colors.success, fontSize: 13, fontWeight: '700' },
  otpVerifyBtn: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  otpVerifyText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  otpInput: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 10, color: colors.text, fontSize: 30, letterSpacing: 14, textAlign: 'center', paddingVertical: 12, marginBottom: 14 },
  otpPrimaryBtn: { backgroundColor: colors.success, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  otpPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  otpGhostBtn: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  otpGhostText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  startBtn: { flex: 1, backgroundColor: colors.success, borderRadius: 8, height: 42, alignItems: 'center', justifyContent: 'center' },
  cancelRideBtn: { paddingHorizontal: 14, backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: '#ef4444', borderRadius: 8, height: 42, alignItems: 'center', justifyContent: 'center' },
  cancelRideBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '700' },
  completeBtn: { flex: 1, backgroundColor: '#1E4E8C', borderRadius: 8, height: 42, alignItems: 'center', justifyContent: 'center' },
  startBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  chatMiniBtn: { width: 42, height: 42, borderRadius: 8, borderWidth: 1, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  chatMiniText: { fontSize: 16 },
  passengerBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  passengerAvatars: { flexDirection: 'row' },
  avatarMini: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.card },
  seatText: { color: colors.textMuted, fontWeight: '500', fontSize: 14 },
  badgeRow: { flexDirection: 'row', gap: 6 },
  miniBadge: { fontSize: 9, color: colors.primary, backgroundColor: 'rgba(255,107,53,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontWeight: 'bold' },


  formContainer: { flex: 1, backgroundColor: colors.card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: colors.cardBorder },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  formTitle: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  formGroup: { marginBottom: 16 },
  formLabel: { fontSize: 13, color: colors.text, fontWeight: 'bold', marginBottom: 8 },
  formHint: { fontSize: 11.5, color: colors.textMuted, marginTop: -4, marginBottom: 8, lineHeight: 16 },
  vehicleDetailRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  pickupRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.inputBackground, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, borderWidth: 1, borderColor: colors.cardBorder },
  pickupLabel: { flex: 1, fontSize: 13, color: colors.text },
  depSummary: { fontSize: 12.5, color: colors.success, fontWeight: '600', marginTop: 4 },
  depSummaryBad: { color: '#C0392B' },
  derivedValue: { fontSize: 18, color: colors.text, fontWeight: '700' },
  useSuggested: { fontSize: 12.5, color: colors.primary, fontWeight: '600', marginTop: 10 },
  formSubLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  formInput: { backgroundColor: colors.inputBackground, borderRadius: 8, height: 44, paddingHorizontal: 12, color: colors.text, borderWidth: 1, borderColor: colors.cardBorder },
  suggBox: { backgroundColor: colors.inputBackground, borderRadius: 8, marginTop: 4, borderWidth: 1, borderColor: colors.cardBorder },
  suggItem: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  suggText: { color: colors.text, fontSize: 13 },
  seatRow: { flexDirection: 'row', alignItems: 'center' },
  seatBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.inputBackground, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  seatBtnDisabled: { opacity: 0.4 },
  seatBtnText: { color: colors.text, fontSize: 22, fontWeight: '800' },
  seatCount: { color: colors.text, fontSize: 18, fontWeight: '800', minWidth: 48, textAlign: 'center' },
  depRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  depChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.cardBorder },
  depChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  depChipText: { color: colors.textMuted, fontWeight: '700', fontSize: 12 },
  depChipTextActive: { color: '#fff' },
  vehicleSelectRow: { flexDirection: 'row', gap: 12 },
  vehicleSelectBtn: { flex: 1, backgroundColor: colors.inputBackground, paddingVertical: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  vehicleSelectBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  vehicleSelectBtnText: { color: colors.textMuted, fontWeight: 'bold', fontSize: 14 },
  vehicleSelectBtnTextActive: { color: '#fff' },

  pricingCard: { backgroundColor: colors.inputBackground, padding: 16, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: colors.cardBorder },
  pricingTitle: { fontSize: 13, fontWeight: 'bold', color: colors.success, marginBottom: 4 },
  pricingSub: { fontSize: 11, color: colors.textMuted, marginBottom: 8 },
  pricingSuggested: { fontSize: 24, fontWeight: '900', color: colors.text, marginBottom: 12 },
  priceInputGroup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  priceInputLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  priceInput: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, color: colors.text, borderRadius: 6, width: 80, paddingHorizontal: 8, textAlign: 'center', height: 36 },

  formSwitchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  daysContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  dayChip: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.inputBackground, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipText: { color: colors.textMuted, fontWeight: 'bold', fontSize: 12 },
  dayChipTextActive: { color: '#fff' },

  formSectionTitle: { fontSize: 14, fontWeight: 'bold', color: colors.text, marginVertical: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  prefSwitchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  prefLabel: { color: colors.textMuted, fontSize: 13 },
  chatSelectRow: { flexDirection: 'row', gap: 8 },
  chatBtn: { flex: 1, backgroundColor: colors.inputBackground, paddingVertical: 8, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  chatBtnActive: { backgroundColor: colors.success, borderColor: colors.success },
  chatBtnText: { fontSize: 11, color: colors.textMuted, fontWeight: 'bold' },
  chatBtnTextActive: { color: '#fff' },

  submitBtn: { backgroundColor: colors.success, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 24, marginBottom: 40 },
  submitBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  requestCard: { backgroundColor: colors.inputBackground, padding: 18, borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.cardBorder },
  reqHeader: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  reqAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cardBorder },
  reqName: { fontSize: 16, fontWeight: 'bold', color: colors.text },
  reqRating: { color: '#f59e0b', fontSize: 12, fontWeight: 'bold', marginTop: 2 },
  
  reqLinkedinBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,119,181,0.1)', padding: 6, borderRadius: 6, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(0,119,181,0.25)', alignSelf: 'flex-start' },
  reqLinkedinText: { fontSize: 10, color: '#60a5fa', fontWeight: '500' },
  
  reqRoute: { backgroundColor: colors.card, padding: 10, borderRadius: 8, marginBottom: 14, borderWidth: 1, borderColor: colors.cardBorder },
  reqRouteText: { color: colors.textMuted, fontSize: 13 },
  actionRow: { flexDirection: 'row', gap: 12 },
  declineBtn: { width: 50, height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: '#ef4444', alignItems: 'center', justifyContent: 'center' },
  acceptBtn: { flex: 1, height: 44, backgroundColor: colors.success, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  acceptText: { color: 'white', fontWeight: 'bold', fontSize: 15 },

  driveContainer: { flex: 1, justifyContent: 'space-between', paddingBottom: 40 },
  driveHeader: { alignItems: 'center', marginTop: 20, marginBottom: 40 },
  driveTitle: { fontSize: 24, fontWeight: 'bold', color: colors.text, marginTop: 12 },
  driveEta: { fontSize: 18, color: colors.success, fontWeight: 'bold', marginTop: 4 },
  stopList: { flex: 1 },
  stopItemActive: { backgroundColor: 'rgba(16,185,129,0.15)', padding: 20, borderRadius: 16, borderWidth: 2, borderColor: colors.success, marginBottom: 12 },
  stopLabel: { color: colors.success, fontWeight: 'bold', fontSize: 12, marginBottom: 4 },
  stopItem: { backgroundColor: colors.inputBackground, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, marginBottom: 12 },
  stopLocation: { color: colors.text, fontSize: 16, fontWeight: '600' },
  hugeActionBtn: { backgroundColor: colors.success, height: 68, borderRadius: 16, alignItems: 'center', justifyContent: 'center', shadowColor: colors.success, shadowOpacity: 0.3, shadowRadius: 10 },
  hugeActionText: { color: 'white', fontSize: 20, fontWeight: 'bold' }
});
