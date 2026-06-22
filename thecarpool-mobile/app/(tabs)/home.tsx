import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import auth from '@react-native-firebase/auth';
import { colors } from '../../theme/colors';
import { apiFetch } from '../services/api';
import { useAuthStore } from '../store/authStore';
import BookingConfirmModal, { BookingDraft } from '../components/BookingConfirmModal';

// apiFetch (from services/api) automatically attaches the Firebase ID token.

interface Ride {
  id: number;
  driver_name: string;
  seats_available: number;
  price_split: number;
  departure_time: string;
  pickup_deviation: number;
}

export default function HomeScreen() {
  const router = useRouter();
  const userId = auth().currentUser?.uid ?? null;
  const { kycStatus } = useAuthStore();
  const kycVerified = kycStatus === 'verified';
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [rides, setRides] = useState<Ride[]>([]);
  const [searching, setSearching] = useState(false);

  // Geo selections drive the real search coordinates (M02).
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [originSug, setOriginSug] = useState<any[]>([]);
  const [destSug, setDestSug] = useState<any[]>([]);

  // Booking confirmation modal state.
  const [confirmRide, setConfirmRide] = useState<Ride | null>(null);
  const [booking, setBooking] = useState(false);

  const searchGeo = async (q: string, setSuggestions: (s: any[]) => void) => {
    if (q.trim().length < 3) { setSuggestions([]); return; }
    try {
      const res = await apiFetch(`/api/geo/search?query=${encodeURIComponent(q)}`);
      if (!res.ok) { setSuggestions([]); return; }
      const data = await res.json();
      const suggestions = data.results || data.suggestions || (Array.isArray(data) ? data : []);
      setSuggestions(suggestions);
    } catch {
      setSuggestions([]);
    }
  };

  const searchMatchingRides = async () => {
    // M02: require confirmed geo coords before searching.
    if (!originCoords || !destCoords) {
      Alert.alert('Select Location', 'Please select pickup and dropoff from suggestions.');
      return;
    }
    setSearching(true);
    try {
      const payload = {
        pickup_lng: originCoords.lng,
        pickup_lat: originCoords.lat,
        drop_lng: destCoords.lng,
        drop_lat: destCoords.lat,
        max_detour_meters: 1500
      };

      const res = await apiFetch('/api/rides/search', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        Alert.alert('Search Failed', errData.error || `Server error (${res.status}). Please try again.`);
        return;
      }
      const data = await res.json();
      setRides(Array.isArray(data) ? data : []);

      if (!Array.isArray(data) || data.length === 0) {
        Alert.alert('No matches found', 'No active drivers matched your route yet. Try a wider area or check back shortly.');
      }
    } catch (err) {
      // Search error is non-fatal — empty results shown to user
      setRides([]);
      Alert.alert('Search Failed', 'Could not reach the server. Please check your connection and try again.');
    } finally {
      setSearching(false);
    }
  };

  // Step 1 — tapping "Book" opens the confirmation modal. We intentionally do
  // NOT gate on KYC here so the rider can review the price/escrow first; the
  // KYC requirement is enforced when they confirm.
  const bookRide = (ride: Ride) => {
    setConfirmRide(ride);
  };

  // Step 2 — the modal confirms with its own (editable) source/destination + seats.
  const confirmBooking = async (draft: BookingDraft) => {
    const ride = confirmRide;
    if (!ride) return;
    // Enforce verification only at confirm time, after the price was shown.
    if (!kycVerified) {
      setConfirmRide(null);
      Alert.alert(
        'Verification required',
        'Complete a quick verification (Aadhaar + PAN + selfie, ~2 mins) to book your ride.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Verify now', onPress: () => router.push('/onboarding') },
        ]
      );
      return;
    }
    setBooking(true);
    try {
      const res = await apiFetch('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          ride_id: ride.id,
          rider_id: userId,
          seats_booked: draft.seats_booked,
          pickup_lng: draft.pickup_lng,
          pickup_lat: draft.pickup_lat,
          drop_lng: draft.drop_lng,
          drop_lat: draft.drop_lat,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 403) {
          setConfirmRide(null);
          Alert.alert(
            'Verification required',
            'Complete a quick verification to book a ride.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Verify now', onPress: () => router.push('/onboarding') },
            ]
          );
          return;
        }
        Alert.alert('Booking Failed', errData.error || `Server error (${res.status}). Please try again.`);
        return;
      }
      const result = await res.json();
      setConfirmRide(null);
      Alert.alert(
        '✅ Booking Confirmed!',
        `Your seat is reserved. Booking #${result.id || result.booking_id || 'N/A'}\nEscrow locked: ₹${result.escrow_locked || result.amount || ''}`,
        [{ text: 'View Trip', onPress: () => router.push(`/trip/${result.ride_id || ride.id}`) }]
      );
    } catch (err: any) {
      // Booking error handled by Alert above
      Alert.alert('Booking Failed', 'Network error. Please check your connection and try again.');
    } finally {
      setBooking(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>TheCarPool</Text>
        <Text style={styles.tagline}>Smart Workplace Carpooling</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Where are you commuting?</Text>
        
        <TextInput
          style={styles.input}
          value={origin}
          onChangeText={(t) => { setOrigin(t); searchGeo(t, setOriginSug); }}
          placeholder="Origin location..."
          placeholderTextColor="#6b7280"
        />
        {originSug.length > 0 && (
          <View style={styles.suggBox}>
            {originSug.slice(0, 5).map((s, i) => (
              <TouchableOpacity key={i} style={styles.suggItem} onPress={() => {
                setOrigin(`${s.place_name}${s.postal_code ? ` (${s.postal_code})` : ''}`);
                setOriginCoords({ lat: s.latitude ?? s.lat ?? 0, lng: s.longitude ?? s.lng ?? 0 });
                setOriginSug([]);
              }}>
                <Text style={styles.suggText} numberOfLines={1}>{s.place_name}{s.state_name ? `, ${s.state_name}` : ''}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TextInput
          style={styles.input}
          value={destination}
          onChangeText={(t) => { setDestination(t); searchGeo(t, setDestSug); }}
          placeholder="Office park destination..."
          placeholderTextColor="#6b7280"
        />
        {destSug.length > 0 && (
          <View style={styles.suggBox}>
            {destSug.slice(0, 5).map((s, i) => (
              <TouchableOpacity key={i} style={styles.suggItem} onPress={() => {
                setDestination(`${s.place_name}${s.postal_code ? ` (${s.postal_code})` : ''}`);
                setDestCoords({ lat: s.latitude ?? s.lat ?? 0, lng: s.longitude ?? s.lng ?? 0 });
                setDestSug([]);
              }}>
                <Text style={styles.suggText} numberOfLines={1}>{s.place_name}{s.state_name ? `, ${s.state_name}` : ''}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity 
          style={styles.btn} 
          onPress={searchMatchingRides} 
          disabled={searching}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Search for Matching Rides"
        >
          <Text style={styles.btnText}>{searching ? 'Scanning Routes...' : 'Search Matching Rides'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Available Matches</Text>

      {rides.map(ride => (
        <View key={ride.id} style={styles.rideCard}>
          <View style={styles.rideHeader}>
            <Text style={styles.driverName}>{ride.driver_name}</Text>
            <Text style={styles.price}>₹{ride.price_split}</Text>
          </View>
          
          <View style={styles.rideDetails}>
            <Text style={styles.detailText}>🕒 Departs: {ride.departure_time}</Text>
            <Text style={styles.detailText}>💺 Seats Open: {ride.seats_available}</Text>
            <Text style={styles.detailText}>📍 Detour: {ride.pickup_deviation}m from your point</Text>
          </View>

          <TouchableOpacity 
            style={styles.bookBtn} 
            onPress={() => bookRide(ride)}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={`Book and Lock Escrow with ${ride.driver_name}`}
          >
            <Text style={styles.bookBtnText}>Book & Lock Escrow</Text>
          </TouchableOpacity>
        </View>
      ))}

      <BookingConfirmModal
        visible={confirmRide !== null}
        ride={confirmRide}
        initialOrigin={origin}
        initialOriginCoords={originCoords}
        initialDestination={destination}
        initialDestCoords={destCoords}
        submitting={booking}
        onConfirm={confirmBooking}
        onClose={() => { if (!booking) setConfirmRide(null); }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 16,
  },
  header: {
    alignItems: 'center',
    marginVertical: 20,
  },
  logo: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.primary,
  },
  tagline: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  input: {
    backgroundColor: colors.inputBackground,
    borderRadius: 8,
    height: 44,
    paddingHorizontal: 12,
    color: colors.text,
    marginBottom: 12,
  },
  suggBox: {
    backgroundColor: colors.inputBackground,
    borderRadius: 8,
    marginTop: -8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  suggItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  suggText: { color: colors.text, fontSize: 13 },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  rideCard: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 12,
  },
  rideHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  driverName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  price: {
    color: colors.success,
    fontWeight: '800',
    fontSize: 16,
  },
  rideDetails: {
    marginBottom: 12,
  },
  detailText: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 3,
  },
  bookBtn: {
    backgroundColor: colors.success,
    borderRadius: 6,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bookBtnText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  }
});
