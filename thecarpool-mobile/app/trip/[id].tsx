import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Alert, Platform, Share, Linking, LayoutAnimation, UIManager } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import io from 'socket.io-client';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { ShieldAlert, Share2, MapPin, MessageCircle, Phone, Mail, Navigation, ChevronUp, ChevronDown } from 'lucide-react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const MAP_PROVIDER = Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined;
import { auth } from '../services/firebase';
import { API_URL, apiFetch } from '../services/api';
import * as haptics from '../services/haptics';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';
import HapticPressable from '../components/HapticPressable';
import { useI18n } from '../services/i18n';

const SOCKET_URL = API_URL;

/**
 * How long SOS waits for a GPS fix before sending the best position it
 * already has. Deliberately short: help arriving at a roughly right place
 * beats help not being called.
 */
const SOS_FIX_TIMEOUT_MS = 5000;

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function TripScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const mapRef = useRef<MapView | null>(null);

  // Live driver state
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [speed, setSpeed] = useState(0);
  const [bearing, setBearing] = useState(0);
  const [geofenceAlert, setGeofenceAlert] = useState<string | null>(null);
  const [ride, setRide] = useState<any | null>(null);
  const [boardingOtp, setBoardingOtp] = useState<string | null>(null);
  const [boardingVerified, setBoardingVerified] = useState<boolean>(false);
  const [bookingStatus, setBookingStatus] = useState<string>('CONFIRMED');
  const [isSheetExpanded, setIsSheetExpanded] = useState<boolean>(false);

  const toggleSheet = () => {
    haptics.tap();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsSheetExpanded((prev) => !prev);
  };

  const fetchRideData = async () => {
    try {
      const [rRes, bRes] = await Promise.all([
        apiFetch(`/api/rides/${id}`),
        apiFetch('/api/bookings/mine'),
      ]);
      if (rRes.ok) {
        const rData = await rRes.json();
        setRide(rData);
        if (rData.live_telemetry?.lat && rData.live_telemetry?.lng) {
          setDriverLocation({ lat: rData.live_telemetry.lat, lng: rData.live_telemetry.lng });
          setSpeed(rData.live_telemetry.speed ?? 0);
          setBearing(rData.live_telemetry.bearing ?? 0);
        }
      }
      if (bRes.ok) {
        const data = await bRes.json();
        const bookings: any[] = Array.isArray(data?.bookings) ? data.bookings : [];
        const myBooking = bookings.find(
          (b) => String(b.ride_id) === String(id) && (b.escrow_status === 'HELD' || b.booking_status === 'REQUESTED')
        );
        if (myBooking) {
          setBookingStatus(myBooking.booking_status || 'CONFIRMED');
          setBoardingOtp(myBooking.boarding_otp || null);
          setBoardingVerified(myBooking.boarding_verified ?? false);
        }
      }
    } catch { /* neutral placeholder */ }
  };

  useEffect(() => {
    fetchRideData();
    // Fallback polling every 8s in case WebSocket is interrupted
    const pollTimer = setInterval(fetchRideData, 8000);
    return () => clearInterval(pollTimer);
  }, [id]);

  useEffect(() => {
    let socket: ReturnType<typeof io> | undefined;
    let cancelled = false;
    (async () => {
      const token = await auth().currentUser?.getIdToken();
      if (cancelled) return;
      socket = io(SOCKET_URL, { auth: { token } });
      socket.on('connect', () => socket?.emit('ride:join', id));
      socket.on('telemetry:broadcast', (data) => {
        if (typeof data.lat === 'number' && typeof data.lng === 'number') {
          setDriverLocation({ lat: data.lat, lng: data.lng });
          setSpeed(typeof data.speed === 'number' ? data.speed : 0);
          setBearing(typeof data.bearing === 'number' ? data.bearing : 0);
        }
      });
      socket.on('safety:alert', (a) => {
        if (a.type === 'GEOFENCE_BREACH') {
          setGeofenceAlert('Driver has deviated > 100m from the planned route.');
          haptics.warning(); // buzz the rider so the alert isn't missed
        }
      });
    })();
    return () => { cancelled = true; socket?.disconnect(); };
  }, [id]);

  // Derived route coordinates for rendering polyline
  const routePoints = useMemo(() => {
    if (!ride) return [];
    if (Array.isArray(ride.route_coords) && ride.route_coords.length > 0) {
      return ride.route_coords
        .filter((p: any) => typeof p?.lat === 'number' && typeof p?.lng === 'number')
        .map((p: any) => ({ latitude: p.lat, longitude: p.lng }));
    }
    if (ride.route_geojson?.coordinates && Array.isArray(ride.route_geojson.coordinates)) {
      return ride.route_geojson.coordinates.map((c: any) => ({ latitude: c[1], longitude: c[0] }));
    }
    return [];
  }, [ride]);

  const pickupPoint = useMemo(() => {
    const lat = Number(ride?.pickup_lat) || routePoints[0]?.latitude;
    const lng = Number(ride?.pickup_lng) || routePoints[0]?.longitude;
    return lat && lng ? { latitude: lat, longitude: lng } : null;
  }, [ride, routePoints]);

  const dropPoint = useMemo(() => {
    const lat = Number(ride?.drop_lat) || routePoints[routePoints.length - 1]?.latitude;
    const lng = Number(ride?.drop_lng) || routePoints[routePoints.length - 1]?.longitude;
    return lat && lng ? { latitude: lat, longitude: lng } : null;
  }, [ride, routePoints]);

  // Live distance and ETA
  const liveDistanceKm = useMemo(() => {
    if (!driverLocation || !pickupPoint) return null;
    return haversineDistanceKm(driverLocation.lat, driverLocation.lng, pickupPoint.latitude, pickupPoint.longitude);
  }, [driverLocation, pickupPoint]);

  const liveEtaMins = useMemo(() => {
    if (liveDistanceKm === null) return null;
    const effectiveSpeed = Math.max(speed, 25); // assume 25 km/h if idle in traffic
    return Math.max(1, Math.round((liveDistanceKm / effectiveSpeed) * 60));
  }, [liveDistanceKm, speed]);

  const dispatchSOS = async () => {
    try {
      // Send the RIDER's own position — they are the person who needs help, and
      // they may no longer be with the vehicle. The driver's last known
      // location is only a fallback for when location access is refused, and
      // previously it was the only thing sent.
      let latitude: number | undefined;
      let longitude: number | undefined;
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status === 'granted') {
          // Bounded wait. A high-accuracy fix indoors, in a tunnel or in a
          // multi-storey car park can take tens of seconds or never arrive,
          // and this is the SOS path — the one place where waiting for a
          // better answer is worse than sending a rougher one now. After
          // SOS_FIX_TIMEOUT_MS we fall through to the last known position,
          // and failing that to the driver's last broadcast.
          const fix = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), SOS_FIX_TIMEOUT_MS)),
          ]);
          const pos = fix ?? (await Location.getLastKnownPositionAsync());
          if (pos) {
            latitude = pos.coords.latitude;
            longitude = pos.coords.longitude;
          }
        }
      } catch { /* fall back below */ }
      if (latitude === undefined || longitude === undefined) {
        latitude = driverLocation?.lat;
        longitude = driverLocation?.lng;
      }
      if (latitude === undefined || longitude === undefined) {
        Alert.alert('Location unavailable', 'Enable location access so we can send help to the right place, or call emergency services directly.');
        return;
      }

      const res = await apiFetch('/api/safety/sos/trigger', {
        method: 'POST',
        body: JSON.stringify({ ride_id: id, latitude, longitude, is_silent: false }),
      });
      if (res.ok) { haptics.sos(); Alert.alert('SOS dispatched', 'Your emergency alert and live location have been sent. Help is on the way.'); }
      else if (res.status === 429) Alert.alert('Already sent', 'An SOS was dispatched moments ago.');
      else Alert.alert('SOS failed', 'Could not dispatch. Please call emergency services directly.');
    } catch { Alert.alert('SOS failed', 'Network error. Please call emergency services directly.'); }
  };

  const triggerSOS = () => { haptics.error(); Alert.alert('🚨 Activate SOS', 'Broadcast your live location to your safety circle and TheCarPool support?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Confirm SOS', style: 'destructive', onPress: dispatchSOS },
  ]); };

  const shareTrip = async () => {
    try {
      await Share.share({
        message: `I'm on a TheCarPool trip #${id}. Vehicle: ${ride?.vehicle_plate || 'shared ride'}. Follow my live location for safety.`,
      });
    } catch { /* user dismissed */ }
  };

  // ── Post-trip rating ─────────────────────────────────────────
  const [showRating, setShowRating] = useState(false);
  const [stars, setStars] = useState(0);
  const [feltSafe, setFeltSafe] = useState<boolean | null>(null);
  const [submittingRating, setSubmittingRating] = useState(false);

  const submitRating = async () => {
    if (stars === 0) { Alert.alert('Rate your trip', 'Tap a star rating first.'); return; }
    setSubmittingRating(true);
    try {
      await apiFetch('/api/safety/ratings/submit', {
        method: 'POST',
        body: JSON.stringify({
          ride_id: id,
          ratee_id: ride?.driver_uid || ride?.driver_id || 'unknown',
          rating_score: stars,
          feedback: feltSafe === null ? undefined : (feltSafe ? 'felt_safe' : 'felt_unsafe'),
        }),
      });
      // A "felt unsafe" answer routes to the safety team regardless of rating.
      if (feltSafe === false) {
        Alert.alert('Thank you', 'Your safety feedback has been flagged to our safety team. We take this seriously.');
      } else {
        Alert.alert('Thank you!', 'Your rating helps keep the community trustworthy.');
      }
      router.replace('/(tabs)');
    } catch {
      Alert.alert('Could not submit', 'Please try again.');
    } finally {
      setSubmittingRating(false);
    }
  };

  return (
    <View style={styles.screen}>
      {/* Map */}
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          provider={MAP_PROVIDER}
          style={StyleSheet.absoluteFill}
          initialRegion={{
            // Initial focus on driver or rider pickup point
            latitude: driverLocation?.lat ?? pickupPoint?.latitude ?? 28.6139,
            longitude: driverLocation?.lng ?? pickupPoint?.longitude ?? 77.2090,
            latitudeDelta: 0.025,
            longitudeDelta: 0.025,
          }}
        >
          {/* Planned Route Line */}
          {routePoints.length > 1 && (
            <Polyline
              coordinates={routePoints}
              strokeColor="#2563EB"
              strokeWidth={5}
              lineCap="round"
              lineJoin="round"
            />
          )}

          {/* Pickup Point Marker */}
          {pickupPoint && (
            <Marker
              coordinate={pickupPoint}
              title="Pickup Point"
              description={ride?.source || 'Boarding location'}
            >
              <View style={styles.pickupPin}>
                <View style={styles.pickupPinDot} />
              </View>
            </Marker>
          )}

          {/* Destination Drop Point Marker */}
          {dropPoint && (
            <Marker
              coordinate={dropPoint}
              title="Destination"
              description={ride?.destination || 'Drop-off location'}
            >
              <View style={styles.destPin}>
                <Text style={{ fontSize: 16 }}>🏁</Text>
              </View>
            </Marker>
          )}

          {/* 🚗 Live Car Marker */}
          {driverLocation && (
            <Marker
              coordinate={{ latitude: driverLocation.lat, longitude: driverLocation.lng }}
              title={ride?.driver_name ? `${ride.driver_name}'s Car` : 'Driver'}
              description={`${speed > 0 ? `${speed} km/h · ` : ''}Live on road`}
              anchor={{ x: 0.5, y: 0.5 }}
              flat={true}
              rotation={bearing}
            >
              <View style={styles.carMarker}>
                <Text style={styles.carEmoji}>🚗</Text>
              </View>
            </Marker>
          )}
        </MapView>

        {!driverLocation && (
          <View style={styles.awaitingBox}>
            <Text style={styles.awaitingText}>
              {ride?.status === 'STARTED' || ride?.status === 'IN_PROGRESS'
                ? 'Connecting to driver’s live GPS…'
                : 'Live tracking activates when your driver starts the trip.'}
            </Text>
          </View>
        )}

        <HapticPressable
          style={[styles.backChip, { top: insets.top + 8 }]}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
        >
          <Text style={styles.backChipText}>← Home</Text>
        </HapticPressable>

        {driverLocation && (
          <HapticPressable
            style={[styles.recenterBtn, { top: insets.top + 8 }]}
            onPress={() => {
              mapRef.current?.animateToRegion({
                latitude: driverLocation.lat,
                longitude: driverLocation.lng,
                latitudeDelta: 0.015,
                longitudeDelta: 0.015,
              }, 500);
            }}
          >
            <Navigation color={c.textPrimary} size={14} />
            <Text style={styles.recenterText}>Car</Text>
          </HapticPressable>
        )}
      </View>

      {/* Bottom sheet with Hide / Unhide Toggle */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + (isSheetExpanded ? space.lg : space.sm) }]}>
        {/* Drag / Tap Handle Bar */}
        <HapticPressable style={styles.sheetHandleWrap} onPress={toggleSheet} activeOpacity={0.7}>
          <View style={styles.sheetHandlePill} />
          <View style={styles.sheetHandleLabelRow}>
            <Text style={styles.sheetHandleLabel}>
              {isSheetExpanded ? '▾ Tap to minimize details (view full map)' : '▴ Tap to view driver, OTP & safety details'}
            </Text>
          </View>
        </HapticPressable>

        {/* Primary Status & ETA Header */}
        <HapticPressable style={styles.statusRow} onPress={toggleSheet} activeOpacity={0.9}>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusLabel}>
              {driverLocation ? '🟢 Live Car Tracking' : 'Trip Scheduled'}
            </Text>
            <Text style={styles.eta}>
              {liveEtaMins !== null ? (
                <>Arriving in <Text style={styles.etaMono}>~{liveEtaMins} min</Text>{liveDistanceKm !== null ? ` (${liveDistanceKm.toFixed(1)} km)` : ''}</>
              ) : driverLocation ? (
                'Live location active'
              ) : (
                'Waiting for driver'
              )}
            </Text>
          </View>
          <View style={styles.headerRightActions}>
            <View style={styles.speedPill}>
              <Text style={styles.speedText}>{speed} km/h</Text>
            </View>
            <HapticPressable
              haptic="tap"
              style={styles.toggleSheetBtn}
              onPress={toggleSheet}
              accessibilityLabel={isSheetExpanded ? 'Hide details' : 'Show details'}
            >
              {isSheetExpanded ? (
                <ChevronDown color={c.textPrimary} size={18} />
              ) : (
                <ChevronUp color={c.textPrimary} size={18} />
              )}
            </HapticPressable>
          </View>
        </HapticPressable>

        {/* Compact Mode Quick Snippet (Visible when collapsed) */}
        {!isSheetExpanded && (
          <HapticPressable style={styles.compactQuickRow} onPress={toggleSheet} activeOpacity={0.85}>
            {boardingOtp && (
              <View style={styles.compactOtpPill}>
                <Text style={styles.compactOtpLabel}>🛡️ OTP</Text>
                <Text style={styles.compactOtpValue}>{boardingOtp}</Text>
                {boardingVerified && <Text style={styles.compactVerifiedBadge}>✓</Text>}
              </View>
            )}
            <View style={styles.compactDriverPill}>
              <Text style={styles.compactDriverText} numberOfLines={1}>
                🚗 {ride?.driver_name || 'Driver'} · Trip #{String(id).slice(0, 6)}
              </Text>
            </View>
            <Text style={styles.compactExpandPrompt}>Details ▴</Text>
          </HapticPressable>
        )}

        {/* Expanded Full Details (Visible when expanded) */}
        {isSheetExpanded && (
          <>
            {geofenceAlert ? (
              <View style={styles.alertBox}>
                <ShieldAlert color={c.danger} size={16} strokeWidth={2.4} />
                <Text style={styles.alertText}>{geofenceAlert}</Text>
              </View>
            ) : (
              <View style={styles.okBox}>
                <Text style={styles.okText}>✓ On planned route · within safe detour threshold</Text>
              </View>
            )}

            {/* ⏳ Waiting for Driver Approval Card */}
            {bookingStatus === 'REQUESTED' && (
              <View style={[styles.alertBox, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                <Text style={[styles.alertText, { color: '#92400E' }]}>
                  ⏳ Waiting for driver approval. Once the driver accepts your request, your 4-digit Boarding OTP and seat confirmation will appear here.
                </Text>
              </View>
            )}

            {/* 🛡️ Boarding Verification OTP Card */}
            {boardingOtp && bookingStatus !== 'REQUESTED' && (
              <View style={styles.otpCard}>
                <View style={styles.otpCardHeader}>
                  <Text style={styles.otpCardTitle}>🛡️ Boarding Verification OTP</Text>
                  {boardingVerified && <Text style={styles.verifiedBadge}>✓ Verified</Text>}
                </View>
                <Text style={styles.otpCardSub}>
                  {boardingVerified
                    ? 'Your identity has been verified by the driver.'
                    : 'Share this 4-digit code with your driver before getting in:'}
                </Text>
                <View style={styles.otpBox}>
                  <Text style={styles.otpCode}>{boardingOtp}</Text>
                </View>
              </View>
            )}

            <View style={styles.tripCard}>
              <View style={styles.tripIcon}><MapPin color={c.textSecondary} size={18} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.tripId}>Trip #{String(id).slice(0, 8)}</Text>
                <Text style={styles.tripVehicle}>
                  {ride ? `${ride.vehicle_plate || ''}${ride.vehicle ? ` · ${ride.vehicle}` : ''}` : 'Loading vehicle…'}
                </Text>
              </View>
            </View>

            {/* Driver Contact & Profile Card */}
            {ride && (
              <View style={styles.driverContactCard}>
                <View style={styles.driverInfoRow}>
                  <View style={styles.driverAvatar}>
                    <Text style={styles.driverAvatarText}>
                      {(ride.driver_name || 'Driver').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.driverName}>{ride.driver_name || 'Driver'}</Text>
                    <Text style={styles.driverRole}>Your Driver</Text>
                  </View>
                  <View style={styles.driverActionsRow}>
                    {ride.driver_phone && (
                      <HapticPressable
                        haptic="tap"
                        style={styles.contactBtn}
                        onPress={() => Linking.openURL(`tel:${ride.driver_phone}`)}
                        accessibilityLabel="Call driver"
                      >
                        <Phone color={c.go} size={18} />
                      </HapticPressable>
                    )}
                    {ride.driver_email && (
                      <HapticPressable
                        haptic="tap"
                        style={styles.contactBtn}
                        onPress={() => Linking.openURL(`mailto:${ride.driver_email}`)}
                        accessibilityLabel="Email driver"
                      >
                        <Mail color={c.textAccent} size={18} />
                      </HapticPressable>
                    )}
                  </View>
                </View>
                {ride.driver_phone && (
                  <Text style={styles.phoneSubText}>📞 {ride.driver_phone}</Text>
                )}
              </View>
            )}

            {!showRating ? (
              <>
                <View style={styles.actions}>
                  <HapticPressable style={styles.sos} onPress={triggerSOS} activeOpacity={0.9}>
                    <ShieldAlert color="#fff" size={18} strokeWidth={2.4} />
                    <Text style={styles.sosText}>{t('sos')}</Text>
                  </HapticPressable>
                  <HapticPressable style={styles.share} onPress={shareTrip} activeOpacity={0.9}>
                    <Share2 color={c.textPrimary} size={17} strokeWidth={2.2} />
                    <Text style={styles.shareText}>{t('share_live_trip')}</Text>
                  </HapticPressable>
                </View>
                <HapticPressable style={styles.chatBtn} onPress={() => router.push(`/chat/${id}`)} activeOpacity={0.9}>
                  <MessageCircle color={c.textPrimary} size={17} strokeWidth={2.2} />
                  <Text style={styles.shareText}>{t('message_cotravellers')}</Text>
                </HapticPressable>
                <HapticPressable style={styles.endTrip} onPress={() => setShowRating(true)}>
                  <Text style={styles.endTripText}>End trip & rate</Text>
                </HapticPressable>
                <HapticPressable style={styles.collapseBottomBtn} onPress={toggleSheet} activeOpacity={0.8}>
                  <Text style={styles.collapseBottomText}>▾ {t('hide_sheet')} · View Full Map</Text>
                </HapticPressable>
              </>
            ) : (
              <View>
                <Text style={styles.rateTitle}>How was your ride?</Text>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <HapticPressable key={n} onPress={() => { haptics.tap(); setStars(n); }}>
                      <Text style={[styles.star, n <= stars && styles.starOn]}>★</Text>
                    </HapticPressable>
                  ))}
                </View>
                <Text style={styles.rateSub}>Did you feel safe on this trip?</Text>
                <View style={styles.safeRow}>
                  <HapticPressable
                    style={[styles.safeBtn, feltSafe === true && styles.safeBtnOn]}
                    onPress={() => setFeltSafe(true)}
                  >
                    <Text style={[styles.safeBtnText, feltSafe === true && { color: '#fff' }]}>Yes, felt safe</Text>
                  </HapticPressable>
                  <HapticPressable
                    style={[styles.safeBtn, feltSafe === false && styles.safeBtnDanger]}
                    onPress={() => setFeltSafe(false)}
                  >
                    <Text style={[styles.safeBtnText, feltSafe === false && { color: '#fff' }]}>No</Text>
                  </HapticPressable>
                </View>
                <HapticPressable style={styles.submitRating} onPress={submitRating} disabled={submittingRating} activeOpacity={0.9}>
                  <Text style={styles.submitRatingText}>{submittingRating ? 'Submitting…' : 'Submit rating'}</Text>
                </HapticPressable>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  mapWrap: { flex: 1 },
  backChip: { position: 'absolute', left: space.lg, backgroundColor: c.surfaceCard, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, ...shadowSm },
  backChipText: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textPrimary },

  recenterBtn: {
    position: 'absolute', right: space.lg, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.surfaceCard, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8,
    ...shadowSm, borderWidth: 1, borderColor: c.borderSubtle,
  },
  recenterText: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textPrimary },

  carMarker: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: '#2563EB',
    ...shadowSm,
  },
  carEmoji: { fontSize: 22 },

  pickupPin: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#16A34A',
    ...shadowSm,
  },
  pickupPinDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#16A34A' },

  destPin: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#DC2626',
    ...shadowSm,
  },

  sheet: {
    backgroundColor: c.bgBase, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl, paddingTop: space.sm, marginTop: -radius.xl,
    borderTopWidth: 1, borderColor: c.borderSubtle, ...shadowLg(),
  },
  sheetHandleWrap: { alignItems: 'center', paddingVertical: 6, marginBottom: 4 },
  sheetHandlePill: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1' },
  sheetHandleLabelRow: { marginTop: 4 },
  sheetHandleLabel: { fontFamily: font.sansMedium, fontSize: 11, color: c.textTertiary },

  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  statusLabel: { fontFamily: font.sansMedium, fontSize: 12.5, color: c.go },
  eta: { fontFamily: font.sansBold, fontSize: 19, color: c.textPrimary, marginTop: 1 },
  etaMono: { fontFamily: font.monoBold, color: c.textPrimary },
  headerRightActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  speedPill: { backgroundColor: c.surfaceSunken, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: c.borderSubtle },
  speedText: { fontFamily: font.mono, fontSize: 12.5, color: c.textSecondary },
  toggleSheetBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: c.surfaceSunken,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.borderSubtle,
  },

  compactQuickRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.surfaceSunken, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9,
    marginTop: 2, borderWidth: 1, borderColor: c.borderSubtle,
  },
  compactOtpPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    borderWidth: 1, borderColor: '#F59E0B',
  },
  compactOtpLabel: { fontFamily: font.sansBold, fontSize: 11, color: '#B45309' },
  compactOtpValue: { fontFamily: font.monoBold, fontSize: 14, color: '#92400E', letterSpacing: 2 },
  compactVerifiedBadge: { fontFamily: font.sansBold, fontSize: 11, color: '#15803D' },
  compactDriverPill: { flex: 1, marginHorizontal: 8 },
  compactDriverText: { fontFamily: font.sansMedium, fontSize: 12, color: c.textSecondary },
  compactExpandPrompt: { fontFamily: font.sansBold, fontSize: 11.5, color: c.goStrong },

  collapseBottomBtn: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 10,
    marginTop: space.sm, backgroundColor: c.surfaceSunken, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.borderSubtle,
  },
  collapseBottomText: { fontFamily: font.sansSemibold, fontSize: 12.5, color: c.textSecondary },

  alertBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.dangerSoft, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  alertText: { flex: 1, fontFamily: font.sansSemibold, fontSize: 12.5, color: c.dangerStrong },
  okBox: { backgroundColor: c.goSoft, borderRadius: radius.md, padding: space.sm, marginBottom: space.md },
  okText: { fontFamily: font.sansMedium, fontSize: 12, color: c.goStrong, textAlign: 'center' },

  awaitingBox: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg, backgroundColor: c.surfaceCard, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: c.borderSubtle, ...shadowSm },
  awaitingText: { fontFamily: font.sansMedium, fontSize: 12.5, color: c.textSecondary, textAlign: 'center' },
  tripCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.surfaceSunken, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  otpCard: { backgroundColor: c.accentSoft, borderRadius: radius.md, padding: space.md, marginBottom: space.md, borderWidth: 1, borderColor: c.borderSubtle },
  otpCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  otpCardTitle: { fontFamily: font.sansBold, fontSize: 14, color: c.textAccent },
  verifiedBadge: { fontFamily: font.sansBold, fontSize: 12, color: c.goStrong, backgroundColor: c.goSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  otpCardSub: { fontFamily: font.sans, fontSize: 12, color: c.textSecondary, marginBottom: 8 },
  otpBox: { backgroundColor: c.bgBase, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: c.borderSubtle },
  otpCode: { fontFamily: font.monoBold, fontSize: 26, color: c.textAccent, letterSpacing: 8 },
  tripIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: c.bgBase, alignItems: 'center', justifyContent: 'center' },
  tripId: { fontFamily: font.monoBold, fontSize: 14, color: c.textPrimary },
  tripVehicle: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary, marginTop: 1 },

  driverContactCard: { backgroundColor: c.surfaceSunken, borderRadius: radius.md, padding: space.md, marginBottom: space.md, borderWidth: 1, borderColor: c.borderSubtle },
  driverInfoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  driverAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.goSoft, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.go },
  driverAvatarText: { fontFamily: font.sansBold, fontSize: 18, color: c.goStrong },
  driverName: { fontFamily: font.sansBold, fontSize: 15, color: c.textPrimary },
  driverRole: { fontFamily: font.sans, fontSize: 12, color: c.textSecondary, marginTop: 1 },
  driverActionsRow: { flexDirection: 'row', gap: space.sm },
  contactBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.surfaceCard, borderWidth: 1, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center' },
  phoneSubText: { fontFamily: font.mono, fontSize: 12.5, color: c.textSecondary, marginTop: 8, marginLeft: 2 },

  actions: { flexDirection: 'row', gap: space.sm },
  sos: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.danger, height: 52, paddingHorizontal: space.xl, borderRadius: radius.md },
  sosText: { fontFamily: font.sansExtrabold, fontSize: 16, color: '#fff', letterSpacing: 0.5 },
  share: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceCard, height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderStrong },
  shareText: { fontFamily: font.sansBold, fontSize: 14.5, color: c.textPrimary },

  chatBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.surfaceCard, height: 48, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.borderStrong, marginTop: space.sm,
  },
  endTrip: { alignItems: 'center', paddingVertical: space.md },
  endTripText: { fontFamily: font.sansSemibold, fontSize: 13.5, color: c.textTertiary, textDecorationLine: 'underline' },

  rateTitle: { fontFamily: font.sansBold, fontSize: 18, color: c.textPrimary, textAlign: 'center', marginBottom: space.sm },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: space.md },
  star: { fontSize: 36, color: c.borderStrong },
  starOn: { color: '#f59e0b' },
  rateSub: { fontFamily: font.sansMedium, fontSize: 13.5, color: c.textSecondary, textAlign: 'center', marginBottom: space.sm },
  safeRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  safeBtn: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surfaceCard },
  safeBtnOn: { backgroundColor: c.go, borderColor: c.go },
  safeBtnDanger: { backgroundColor: c.danger, borderColor: c.danger },
  safeBtnText: { fontFamily: font.sansSemibold, fontSize: 13.5, color: c.textPrimary },
  submitRating: { height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: c.textPrimary, borderRadius: radius.md },
  submitRatingText: { fontFamily: font.sansBold, fontSize: 15, color: c.bgBase },
});

// shadowLg is a style object in tokens; wrap so it can sit inside StyleSheet.create above.
function shadowLg() {
  return { shadowColor: '#0B0F14', shadowOpacity: 0.1, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 12 };
}
