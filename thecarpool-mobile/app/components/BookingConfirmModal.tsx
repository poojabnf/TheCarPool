import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { colors } from '../../theme/colors';
import { apiFetch } from '../services/api';

export interface Coords {
  lat: number;
  lng: number;
}

export interface BookingDraft {
  pickup_lat: number;
  pickup_lng: number;
  drop_lat: number;
  drop_lng: number;
  seats_booked: number;
}

interface Ride {
  id: number;
  driver_name: string;
  seats_available: number;
  price_split: number;
  departure_time: string;
}

interface Props {
  visible: boolean;
  ride: Ride | null;
  /** Pre-fill values carried over from the route search. */
  initialOrigin: string;
  initialOriginCoords: Coords | null;
  initialDestination: string;
  initialDestCoords: Coords | null;
  submitting?: boolean;
  onConfirm: (draft: BookingDraft) => void;
  onClose: () => void;
}

/**
 * Confirmation step shown before locking escrow. The rider can adjust the exact
 * pickup and drop-off (with geo autocomplete) and how many seats to book — all
 * pre-filled from the route they just searched.
 */
export default function BookingConfirmModal({
  visible,
  ride,
  initialOrigin,
  initialOriginCoords,
  initialDestination,
  initialDestCoords,
  submitting = false,
  onConfirm,
  onClose,
}: Props) {
  const [origin, setOrigin] = useState(initialOrigin);
  const [destination, setDestination] = useState(initialDestination);
  const [originCoords, setOriginCoords] = useState<Coords | null>(initialOriginCoords);
  const [destCoords, setDestCoords] = useState<Coords | null>(initialDestCoords);
  const [originSug, setOriginSug] = useState<any[]>([]);
  const [destSug, setDestSug] = useState<any[]>([]);
  const [seats, setSeats] = useState(1);

  // Re-seed from the search whenever the modal is (re)opened for a ride.
  useEffect(() => {
    if (visible) {
      setOrigin(initialOrigin);
      setDestination(initialDestination);
      setOriginCoords(initialOriginCoords);
      setDestCoords(initialDestCoords);
      setOriginSug([]);
      setDestSug([]);
      setSeats(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, ride?.id]);

  const searchGeo = async (q: string, setSuggestions: (s: any[]) => void) => {
    if (q.trim().length < 3) { setSuggestions([]); return; }
    try {
      const res = await apiFetch(`/api/geo/search?query=${encodeURIComponent(q)}`);
      if (!res.ok) { setSuggestions([]); return; }
      const data = await res.json();
      setSuggestions(data.results || data.suggestions || (Array.isArray(data) ? data : []));
    } catch {
      setSuggestions([]);
    }
  };

  const maxSeats = Math.max(1, ride?.seats_available ?? 1);
  const canConfirm = !!originCoords && !!destCoords && !submitting;
  const fareEstimate = ride ? ride.price_split * seats : 0;

  const handleConfirm = () => {
    if (!originCoords || !destCoords) return;
    onConfirm({
      pickup_lat: originCoords.lat,
      pickup_lng: originCoords.lng,
      drop_lat: destCoords.lat,
      drop_lng: destCoords.lng,
      seats_booked: seats,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Confirm your booking</Text>
            {ride && (
              <Text style={styles.subtitle}>
                {ride.driver_name} · ₹{ride.price_split}/seat · {ride.departure_time}
              </Text>
            )}

            {/* Pickup */}
            <Text style={styles.fieldLabel}>Pickup (source)</Text>
            <TextInput
              style={styles.input}
              value={origin}
              onChangeText={(t) => { setOrigin(t); setOriginCoords(null); searchGeo(t, setOriginSug); }}
              placeholder="Where should the driver pick you up?"
              placeholderTextColor={colors.inputPlaceholder}
            />
            {originSug.length > 0 && (
              <View style={styles.suggBox}>
                {originSug.slice(0, 5).map((s, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.suggItem}
                    onPress={() => {
                      setOrigin(`${s.place_name}${s.postal_code ? ` (${s.postal_code})` : ''}`);
                      setOriginCoords({ lat: s.latitude ?? s.lat ?? 0, lng: s.longitude ?? s.lng ?? 0 });
                      setOriginSug([]);
                    }}
                  >
                    <Text style={styles.suggText} numberOfLines={1}>
                      {s.place_name}{s.state_name ? `, ${s.state_name}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Drop */}
            <Text style={styles.fieldLabel}>Drop-off (destination)</Text>
            <TextInput
              style={styles.input}
              value={destination}
              onChangeText={(t) => { setDestination(t); setDestCoords(null); searchGeo(t, setDestSug); }}
              placeholder="Where are you headed?"
              placeholderTextColor={colors.inputPlaceholder}
            />
            {destSug.length > 0 && (
              <View style={styles.suggBox}>
                {destSug.slice(0, 5).map((s, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.suggItem}
                    onPress={() => {
                      setDestination(`${s.place_name}${s.postal_code ? ` (${s.postal_code})` : ''}`);
                      setDestCoords({ lat: s.latitude ?? s.lat ?? 0, lng: s.longitude ?? s.lng ?? 0 });
                      setDestSug([]);
                    }}
                  >
                    <Text style={styles.suggText} numberOfLines={1}>
                      {s.place_name}{s.state_name ? `, ${s.state_name}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Seats */}
            <Text style={styles.fieldLabel}>Seats</Text>
            <View style={styles.seatRow}>
              <TouchableOpacity
                style={[styles.seatBtn, seats <= 1 && styles.seatBtnDisabled]}
                onPress={() => setSeats((s) => Math.max(1, s - 1))}
                disabled={seats <= 1}
              >
                <Text style={styles.seatBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.seatCount}>{seats}</Text>
              <TouchableOpacity
                style={[styles.seatBtn, seats >= maxSeats && styles.seatBtnDisabled]}
                onPress={() => setSeats((s) => Math.min(maxSeats, s + 1))}
                disabled={seats >= maxSeats}
              >
                <Text style={styles.seatBtnText}>+</Text>
              </TouchableOpacity>
              <Text style={styles.seatHint}>{maxSeats} available</Text>
            </View>

            {/* Fare */}
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Escrow to lock</Text>
              <Text style={styles.fareValue}>₹{fareEstimate.toFixed(2)}</Text>
            </View>

            {!canConfirm && !submitting && (!originCoords || !destCoords) && (
              <Text style={styles.warn}>Pick a source and destination from the suggestions to continue.</Text>
            )}

            <TouchableOpacity
              style={[styles.confirmBtn, !canConfirm && styles.confirmBtnDisabled]}
              onPress={handleConfirm}
              disabled={!canConfirm}
              accessibilityRole="button"
              accessibilityLabel="Confirm booking and lock escrow"
            >
              {submitting
                ? <ActivityIndicator color={colors.text} />
                : <Text style={styles.confirmText}>Confirm & Lock Escrow</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={submitting}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 28,
    paddingTop: 10,
    maxHeight: '88%',
    borderTopWidth: 1,
    borderColor: colors.cardBorder,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.cardBorder, marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '900', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 4, marginBottom: 12 },
  fieldLabel: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', marginTop: 12, marginBottom: 6, fontWeight: '700' },
  input: {
    backgroundColor: colors.inputBackground,
    borderRadius: 8,
    height: 44,
    paddingHorizontal: 12,
    color: colors.text,
  },
  suggBox: { backgroundColor: colors.inputBackground, borderRadius: 8, marginTop: 4, borderWidth: 1, borderColor: colors.cardBorder },
  suggItem: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  suggText: { color: colors.text, fontSize: 13 },
  seatRow: { flexDirection: 'row', alignItems: 'center' },
  seatBtn: {
    width: 40, height: 40, borderRadius: 8, backgroundColor: colors.inputBackground,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder,
  },
  seatBtnDisabled: { opacity: 0.4 },
  seatBtnText: { color: colors.text, fontSize: 22, fontWeight: '800' },
  seatCount: { color: colors.text, fontSize: 18, fontWeight: '800', minWidth: 40, textAlign: 'center' },
  seatHint: { color: colors.textMuted, fontSize: 11, marginLeft: 10 },
  fareRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.cardBorder,
  },
  fareLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  fareValue: { color: colors.success, fontSize: 20, fontWeight: '900' },
  warn: { color: colors.primary, fontSize: 11, marginTop: 10 },
  confirmBtn: {
    backgroundColor: colors.success, borderRadius: 8, height: 48,
    justifyContent: 'center', alignItems: 'center', marginTop: 18,
  },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmText: { color: colors.text, fontWeight: '800', fontSize: 15 },
  cancelBtn: { height: 44, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  cancelText: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
});
