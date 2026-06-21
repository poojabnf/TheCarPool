import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform, Share } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import io from 'socket.io-client';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { ShieldAlert, Share2, MapPin } from 'lucide-react-native';

const MAP_PROVIDER = Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined;
import { auth } from '../services/firebase';
import { API_URL, apiFetch } from '../services/api';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';

const SOCKET_URL = API_URL;

export default function TripScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [driverLocation, setDriverLocation] = useState({ lat: 28.4231, lng: 77.0872 });
  const [speed, setSpeed] = useState(0);
  const [geofenceAlert, setGeofenceAlert] = useState<string | null>(null);
  const [ride, setRide] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/rides/${id}`);
        if (res.ok) setRide(await res.json());
      } catch { /* neutral placeholder */ }
    })();
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
        setDriverLocation({ lat: data.lat, lng: data.lng });
        setSpeed(typeof data.speed === 'number' ? data.speed : 0);
      });
      socket.on('safety:alert', (a) => {
        if (a.type === 'GEOFENCE_BREACH') setGeofenceAlert('Driver has deviated > 100m from the planned route.');
      });
    })();
    return () => { cancelled = true; socket?.disconnect(); };
  }, [id]);

  const dispatchSOS = async () => {
    try {
      const res = await apiFetch('/api/safety/sos/trigger', {
        method: 'POST',
        body: JSON.stringify({ ride_id: id, latitude: driverLocation.lat, longitude: driverLocation.lng, is_silent: false }),
      });
      if (res.ok) Alert.alert('SOS dispatched', 'Your emergency alert and live location have been sent. Help is on the way.');
      else if (res.status === 429) Alert.alert('Already sent', 'An SOS was dispatched moments ago.');
      else Alert.alert('SOS failed', 'Could not dispatch. Please call emergency services directly.');
    } catch { Alert.alert('SOS failed', 'Network error. Please call emergency services directly.'); }
  };

  const triggerSOS = () => Alert.alert('🚨 Activate SOS', 'Broadcast your live location to your safety circle and TheCarPool support?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Confirm SOS', style: 'destructive', onPress: dispatchSOS },
  ]);

  const shareTrip = async () => {
    try {
      await Share.share({
        message: `I'm on a TheCarPool trip #${id}. Vehicle: ${ride?.vehicle_plate || 'shared ride'}. Follow my live location for safety.`,
      });
    } catch { /* user dismissed */ }
  };

  return (
    <View style={styles.screen}>
      {/* Map */}
      <View style={styles.mapWrap}>
        <MapView
          provider={MAP_PROVIDER}
          style={StyleSheet.absoluteFill}
          region={{ latitude: driverLocation.lat, longitude: driverLocation.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
        >
          <Marker coordinate={{ latitude: driverLocation.lat, longitude: driverLocation.lng }} title="Driver" description={`${speed} km/h`} />
        </MapView>
        <TouchableOpacity
          style={[styles.backChip, { top: insets.top + 8 }]}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
        >
          <Text style={styles.backChipText}>← Home</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom sheet */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.statusRow}>
          <View>
            <Text style={styles.statusLabel}>On the way</Text>
            <Text style={styles.eta}>Arriving in <Text style={styles.etaMono}>6 min</Text></Text>
          </View>
          <View style={styles.speedPill}><Text style={styles.speedText}>{speed} km/h</Text></View>
        </View>

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

        <View style={styles.tripCard}>
          <View style={styles.tripIcon}><MapPin color={c.textSecondary} size={18} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tripId}>Trip #{String(id).slice(0, 8)}</Text>
            <Text style={styles.tripVehicle}>
              {ride ? `${ride.vehicle_plate || ''}${ride.vehicle ? ` · ${ride.vehicle}` : ''}` : 'Loading vehicle…'}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.sos} onPress={triggerSOS} activeOpacity={0.9}>
            <ShieldAlert color="#fff" size={18} strokeWidth={2.4} />
            <Text style={styles.sosText}>SOS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.share} onPress={shareTrip} activeOpacity={0.9}>
            <Share2 color={c.textPrimary} size={17} strokeWidth={2.2} />
            <Text style={styles.shareText}>Share live trip</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  mapWrap: { flex: 1 },
  backChip: { position: 'absolute', left: space.lg, backgroundColor: c.surfaceCard, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, ...shadowSm },
  backChipText: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textPrimary },

  sheet: {
    backgroundColor: c.bgBase, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl, paddingTop: space.lg, marginTop: -radius.xl,
    borderTopWidth: 1, borderColor: c.borderSubtle, ...shadowLg(),
  },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  statusLabel: { fontFamily: font.sansMedium, fontSize: 12.5, color: c.go },
  eta: { fontFamily: font.sansBold, fontSize: 20, color: c.textPrimary, marginTop: 2 },
  etaMono: { fontFamily: font.monoBold, color: c.textPrimary },
  speedPill: { backgroundColor: c.surfaceSunken, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: c.borderSubtle },
  speedText: { fontFamily: font.mono, fontSize: 13, color: c.textSecondary },

  alertBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.dangerSoft, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  alertText: { flex: 1, fontFamily: font.sansSemibold, fontSize: 12.5, color: c.dangerStrong },
  okBox: { backgroundColor: c.goSoft, borderRadius: radius.md, padding: space.sm, marginBottom: space.md },
  okText: { fontFamily: font.sansMedium, fontSize: 12, color: c.goStrong, textAlign: 'center' },

  tripCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.surfaceSunken, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  tripIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: c.bgBase, alignItems: 'center', justifyContent: 'center' },
  tripId: { fontFamily: font.monoBold, fontSize: 14, color: c.textPrimary },
  tripVehicle: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary, marginTop: 1 },

  actions: { flexDirection: 'row', gap: space.sm },
  sos: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.danger, height: 52, paddingHorizontal: space.xl, borderRadius: radius.md },
  sosText: { fontFamily: font.sansExtrabold, fontSize: 16, color: '#fff', letterSpacing: 0.5 },
  share: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceCard, height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderStrong },
  shareText: { fontFamily: font.sansBold, fontSize: 14.5, color: c.textPrimary },
});

// shadowLg is a style object in tokens; wrap so it can sit inside StyleSheet.create above.
function shadowLg() {
  return { shadowColor: '#0B0F14', shadowOpacity: 0.1, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 12 };
}
