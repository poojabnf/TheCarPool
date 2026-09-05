/**
 * Ride detail, BEFORE booking.
 *
 * Until now a search result was a dead card: the only tap targets were "Book
 * ride", which went straight to checkout, and — once booked — "View trip",
 * which opens the live map. There was no way to look at a ride before paying
 * for it. A rider comparing three drivers could see a name, a price and an
 * arrow, and nothing about where the driver actually starts, which stops they
 * make, or what boarding at one of those stops costs.
 *
 * That last part matters most. Per-stop fares exist and are charged, but the
 * only person who could see them was the driver who typed them in. A rider
 * boarding at Surat on a Delhi-Mumbai run pays the Surat fare and had no way
 * to know that before committing.
 *
 * This screen is read-only. It fetches the ride and hands off to /confirm with
 * exactly the params the home screen would have sent, so booking behaves
 * identically whether the rider taps through here or books from the card.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, MapPin, Circle, Clock, Users, Wind, Venus, Route as RouteIcon } from 'lucide-react-native';
import { apiFetch } from '../../services/api';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import VehicleIcon from '../../components/VehicleIcon';
import { formatMoney } from '../../services/currency';
import { formatDeparture } from '../../services/datetime';
import * as haptics from '../../services/haptics';

interface Stop {
  label?: string | null;
  lat: number;
  lng: number;
  eta?: string | null;
  price?: number | null;
}

function initials(name?: string | null): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function vehicleLabel(ride: any): string {
  const named = [ride?.vehicle_make, ride?.vehicle_model].filter(Boolean).join(' ').trim();
  const head = named
    || (ride?.vehicle_type
      ? ride.vehicle_type.charAt(0) + ride.vehicle_type.slice(1).toLowerCase()
      : 'Car');
  return [head, ride?.vehicle_colour || null].filter(Boolean).join(' · ');
}

function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371e3;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * What a stop costs when the driver left the box blank.
 *
 * Mirrors proportionalStopFare() and remainingMetresFrom() in the backend's
 * stopPricing module — including the projection onto the nearest SEGMENT
 * rather than the nearest vertex, which is not a refinement but the whole
 * thing: a real ride's route is stored as two points, so snapping to a vertex
 * puts every intermediate stop at one end and returns the full fare.
 *
 * This screen only DISPLAYS the number; the server computes the one actually
 * charged. They must agree, so this is a deliberate copy rather than an
 * approximation — if it drifts, a rider is quoted one figure and billed
 * another.
 */
function estimatedStopFare(ride: any, stop: Stop): number | null {
  const full = Number(ride?.price_split);
  if (!Number.isFinite(full) || full <= 0) return null;

  const pts: { lat: number; lng: number }[] = Array.isArray(ride?.route_coords)
    ? ride.route_coords.filter((p: any) => typeof p?.lat === 'number' && typeof p?.lng === 'number')
    : [];
  if (pts.length < 2) return null;

  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += metresBetween(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  }
  if (total <= 0) return null;

  const M_PER_DEG = 111320;
  const meanLat = (pts[0].lat + pts[pts.length - 1].lat) / 2;
  const kx = Math.cos((meanLat * Math.PI) / 180) * M_PER_DEG;
  const px = stop.lng * kx;
  const py = stop.lat * M_PER_DEG;

  let bestPerp = Infinity;
  let bestSeg = -1;
  let bestT = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].lng * kx, ay = pts[i - 1].lat * M_PER_DEG;
    const bx = pts[i].lng * kx, by = pts[i].lat * M_PER_DEG;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const cx = ax + t * dx, cy = ay + t * dy;
    const perp = Math.hypot(px - cx, py - cy);
    if (perp < bestPerp) { bestPerp = perp; bestSeg = i; bestT = t; }
  }
  if (bestSeg === -1) return null;

  let remaining = metresBetween(
    pts[bestSeg - 1].lat, pts[bestSeg - 1].lng, pts[bestSeg].lat, pts[bestSeg].lng
  ) * (1 - bestT);
  for (let i = bestSeg + 1; i < pts.length; i++) {
    remaining += metresBetween(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  }
  if (remaining <= 0) return null;

  return Math.round(full * Math.min(1, remaining / total));
}

export default function RideDetailScreen() {
  const params = useLocalSearchParams();
  const id = String(params.id);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [ride, setRide] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/rides/${id}`);
        if (cancelled) return;
        if (!res.ok) {
          setError('This ride is no longer available.');
        } else {
          setRide(await res.json());
        }
      } catch {
        if (!cancelled) setError("Couldn't load this ride. Check your connection.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const stops: Stop[] = useMemo(
    () => (Array.isArray(ride?.pickup_points) ? ride.pickup_points : []),
    [ride]
  );

  /**
   * Straight back to checkout with the search context the home screen already
   * gathered. Without it /confirm has no pickup or drop coordinates and cannot
   * quote, so the button falls back to sending the rider home to search rather
   * than into a checkout that would fail.
   */
  const book = () => {
    haptics.press();
    const hasSearchContext = params.pickup_lat && params.pickup_lng && params.drop_lat && params.drop_lng;
    if (!hasSearchContext) {
      router.replace('/(tabs)');
      return;
    }
    router.push({
      pathname: '/confirm',
      params: {
        ride_id: String(id),
        driver_name: ride?.driver_name ?? '',
        vehicle: `${vehicleLabel(ride)}${ride?.ac_available ? ' · AC' : ''}`,
        vehicle_plate: ride?.vehicle_plate || '',
        price_split: String(ride?.price_split ?? ''),
        seats: String(params.seats ?? '1'),
        departure_time: ride?.departure_time || '',
        pickup_lat: String(params.pickup_lat),
        pickup_lng: String(params.pickup_lng),
        drop_lat: String(params.drop_lat),
        drop_lng: String(params.drop_lng),
        origin: String(params.origin ?? ''),
        destination: String(params.destination ?? ''),
      },
    });
  };

  const Header = (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      <HapticPressable style={styles.backBtn} onPress={() => router.back()}>
        <ArrowLeft color={c.textPrimary} size={22} strokeWidth={2.2} />
      </HapticPressable>
      <Text style={styles.headerTitle}>Ride details</Text>
      <View style={{ width: 44 }} />
    </View>
  );

  if (loading) {
    return (
      <View style={styles.screen}>
        {Header}
        <View style={styles.center}><ActivityIndicator size="large" color={c.accent} /></View>
      </View>
    );
  }

  if (error || !ride) {
    return (
      <View style={styles.screen}>
        {Header}
        <View style={styles.center}>
          <Text style={styles.errorText}>{error ?? 'Ride not found.'}</Text>
        </View>
      </View>
    );
  }

  const seatsLeft = ride.seats_available;
  const distanceKm = Number(ride.distance_km);

  return (
    <View style={styles.screen}>
      {Header}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Driver */}
        <View style={styles.card}>
          <View style={styles.driverRow}>
            <View style={styles.disc}><Text style={styles.discText}>{initials(ride.driver_name)}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverName}>
                {ride.driver_name || 'Driver'}
                {ride.driver_rating ? `  ★ ${ride.driver_rating}` : ''}
              </Text>
              <View style={styles.vehicleRow}>
                <VehicleIcon vehicleClass={ride.vehicle_class} />
                <Text style={styles.vehicle} numberOfLines={1}>
                  {vehicleLabel(ride)}{ride.is_ev ? ' · EV' : ''}{ride.ac_available ? ' · AC' : ''}
                </Text>
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.fare}>{formatMoney(Number(ride.price_split), { decimals: 0 })}</Text>
              <Text style={styles.perSeat}>full journey</Text>
            </View>
          </View>

          <View style={styles.badgeRow}>
            {['GOLD', 'SILVER', 'BRONZE'].includes(ride.driver_trust_level) && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {ride.driver_trust_level === 'GOLD' ? '🥇 Gold' : ride.driver_trust_level === 'SILVER' ? '🥈 Silver' : '🥉 Bronze'}
                </Text>
              </View>
            )}
            {ride.ac_available && (
              <View style={styles.badge}><Wind color={c.info} size={12} strokeWidth={2.4} /><Text style={styles.badgeText}>AC</Text></View>
            )}
            {ride.women_only && (
              <View style={styles.badge}><Venus color={c.textAccent} size={12} strokeWidth={2.4} /><Text style={styles.badgeText}>Women only</Text></View>
            )}
            {ride.vehicle_plate && (
              <View style={styles.badge}><Text style={styles.badgeText}>{ride.vehicle_plate}</Text></View>
            )}
          </View>
        </View>

        {/* When and how big */}
        <View style={styles.card}>
          <View style={styles.factRow}>
            <Clock color={c.textSecondary} size={15} strokeWidth={2.3} />
            <Text style={styles.factLabel}>Departs</Text>
            <Text style={styles.factValue}>{formatDeparture(ride.departure_time)}</Text>
          </View>
          {Number.isFinite(distanceKm) && distanceKm > 0 && (
            <View style={styles.factRow}>
              <RouteIcon color={c.textSecondary} size={15} strokeWidth={2.3} />
              <Text style={styles.factLabel}>Distance</Text>
              <Text style={styles.factValue}>{Math.round(distanceKm)} km</Text>
            </View>
          )}
          {seatsLeft != null && (
            <View style={[styles.factRow, styles.factRowLast]}>
              <Users color={c.textSecondary} size={15} strokeWidth={2.3} />
              <Text style={styles.factLabel}>Seats left</Text>
              <Text style={[styles.factValue, seatsLeft <= 1 && { color: c.danger }]}>
                {seatsLeft}
              </Text>
            </View>
          )}
        </View>

        {/* The journey: start, every declared stop with what it costs, end.
            This is the part riders could not see anywhere before. */}
        <Text style={styles.sectionTitle}>The journey</Text>
        <View style={styles.card}>
          <View style={styles.timelineRow}>
            <View style={styles.timelineGutter}>
              <Circle color={c.go} size={13} strokeWidth={3} fill={c.go} />
              {(stops.length > 0 || ride.destination) && <View style={styles.timelineLine} />}
            </View>
            <View style={styles.timelineBody}>
              <Text style={styles.timelineKind}>Starts from</Text>
              <Text style={styles.timelinePlace}>{ride.source || 'Pickup point'}</Text>
            </View>
          </View>

          {stops.map((stop, i) => {
            const declared = typeof stop.price === 'number' && stop.price > 0 ? stop.price : null;
            const estimated = declared === null ? estimatedStopFare(ride, stop) : null;
            const shown = declared ?? estimated;
            return (
              <View style={styles.timelineRow} key={`${stop.lat},${stop.lng},${i}`}>
                <View style={styles.timelineGutter}>
                  <MapPin color={c.textAccent} size={14} strokeWidth={2.6} />
                  <View style={styles.timelineLine} />
                </View>
                <View style={styles.timelineBody}>
                  <Text style={styles.timelineKind}>
                    Stop {i + 1}{stop.eta ? ` · around ${stop.eta}` : ''}
                  </Text>
                  <Text style={styles.timelinePlace}>{stop.label || 'Stop on the route'}</Text>
                  {shown !== null ? (
                    <>
                      <Text style={styles.stopFare}>
                        {formatMoney(shown, { decimals: 0 })} per seat from here
                      </Text>
                      <Text style={styles.stopFareNote}>
                        {declared !== null
                          ? 'Set by the driver.'
                          : 'Estimated from the distance you actually travel.'}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.stopFareNote}>
                      Boarding here costs the full fare,{' '}
                      {formatMoney(Number(ride.price_split), { decimals: 0 })} per seat.
                    </Text>
                  )}
                </View>
              </View>
            );
          })}

          <View style={[styles.timelineRow, styles.timelineRowLast]}>
            <View style={styles.timelineGutter}>
              <MapPin color={c.danger} size={14} strokeWidth={2.6} />
            </View>
            <View style={styles.timelineBody}>
              <Text style={styles.timelineKind}>Ends at</Text>
              <Text style={styles.timelinePlace}>{ride.destination || 'Destination'}</Text>
            </View>
          </View>
        </View>

        {stops.length === 0 && (
          <Text style={styles.emptyStops}>
            This driver hasn't added any stops along the way — they collect at the start
            and drive through to the destination.
          </Text>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <HapticPressable haptic="press" style={styles.bookBtn} onPress={book} activeOpacity={0.9}>
          <Text style={styles.bookBtnText}>
            Book this ride · {formatMoney(Number(ride.price_split), { decimals: 0 })}
          </Text>
        </HapticPressable>
        {stops.length > 0 && (
          <Text style={styles.footerNote}>
            You'll pick your boarding point next — the fare updates to match it.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  errorText: { fontFamily: font.sans, fontSize: 14, color: c.textSecondary, textAlign: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  backBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: font.sansBold, fontSize: 17, color: c.textPrimary },

  card: {
    backgroundColor: c.surfaceCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.borderSubtle,
    padding: space.lg,
    marginBottom: space.md,
    ...shadowSm,
  },

  driverRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  disc: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center',
  },
  discText: { fontFamily: font.sansBold, fontSize: 16, color: c.textAccent },
  driverName: { fontFamily: font.sansBold, fontSize: 16, color: c.textPrimary },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  vehicle: { flex: 1, fontFamily: font.sans, fontSize: 12.5, color: c.textSecondary },
  fare: { fontFamily: font.monoBold, fontSize: 20, color: c.textPrimary, letterSpacing: -0.4 },
  perSeat: { fontFamily: font.sans, fontSize: 11, color: c.textTertiary, marginTop: 1 },

  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: space.md },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.surfaceSunken, borderRadius: radius.sm,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  badgeText: { fontFamily: font.sansSemibold, fontSize: 11.5, color: c.textSecondary },

  // A fixed label column, so the values line up down the right rather than
  // starting wherever the label happens to end.
  factRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: c.borderSubtle,
  },
  factRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  factLabel: { width: 78, fontFamily: font.sans, fontSize: 13, color: c.textSecondary },
  factValue: { flex: 1, textAlign: 'right', fontFamily: font.sansSemibold, fontSize: 13.5, color: c.textPrimary },

  sectionTitle: {
    fontFamily: font.sansBold, fontSize: 14, color: c.textPrimary,
    marginTop: space.sm, marginBottom: space.sm,
  },

  timelineRow: { flexDirection: 'row', gap: space.md },
  timelineRowLast: { paddingBottom: 0 },
  // Fixed width so every marker sits on one vertical line and the connector
  // between them is straight.
  timelineGutter: { width: 18, alignItems: 'center', paddingTop: 2 },
  timelineLine: { flex: 1, width: 2, backgroundColor: c.borderSubtle, marginTop: 4, minHeight: 16 },
  timelineBody: { flex: 1, paddingBottom: space.lg },
  timelineKind: { fontFamily: font.sans, fontSize: 11.5, color: c.textTertiary, marginBottom: 2 },
  timelinePlace: { fontFamily: font.sansSemibold, fontSize: 14, color: c.textPrimary, lineHeight: 19 },
  stopFare: { fontFamily: font.monoBold, fontSize: 14, color: c.textAccent, marginTop: 5 },
  stopFareNote: { fontFamily: font.sans, fontSize: 11.5, color: c.textTertiary, marginTop: 2, lineHeight: 16 },

  emptyStops: {
    fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary,
    lineHeight: 18, marginTop: -space.xs, marginBottom: space.md,
  },

  footer: {
    paddingHorizontal: space.xl, paddingTop: space.md,
    borderTopWidth: 1, borderTopColor: c.borderSubtle,
    backgroundColor: c.surfaceCard,
  },
  bookBtn: {
    backgroundColor: c.go, height: 50, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  bookBtnText: { fontFamily: font.sansBold, fontSize: 15, color: '#FFFFFF' },
  footerNote: {
    fontFamily: font.sans, fontSize: 11.5, color: c.textTertiary,
    textAlign: 'center', marginTop: space.sm,
  },
});
