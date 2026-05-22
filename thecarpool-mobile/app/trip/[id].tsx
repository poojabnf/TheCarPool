import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import io from 'socket.io-client';

const SOCKET_URL = 'http://localhost:5000'; // Node socket telemetry server

export default function TripScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [driverLocation, setDriverLocation] = useState({ lat: 28.4231, lng: 77.0872 });
  const [speed, setSpeed] = useState(0);
  const [geofenceAlert, setGeofenceAlert] = useState<string | null>(null);

  useEffect(() => {
    // 1. Establish real-time socket connection
    const socket = io(SOCKET_URL);

    socket.on('connect', () => {
      console.log('Telemetry channel connected.');
      // Join active ride telemetry room
      socket.emit('ride:join', id);
    });

    // 2. Listen to live GPS broadcasts from driver device
    socket.on('telemetry:broadcast', (data) => {
      setDriverLocation({ lat: data.lat, lng: data.lng });
      setSpeed(data.speed || 42);
    });

    // 3. Listen to geofencing breach alerts from gateway matching server
    socket.on('safety:alert', (alertData) => {
      if (alertData.type === 'GEOFENCE_BREACH') {
        setGeofenceAlert('Breached: > 100m off scheduled detour path.');
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [id]);

  const triggerSOS = () => {
    Alert.alert(
      '🚨 EMERGENCY SOS ACTIVATED',
      'Broadcasting real-time coordinates to corporate security circles, emergency contacts, and TheCarPool support team.',
      [
        { text: 'Cancel Alert', style: 'cancel' },
        { text: 'Confirm SOS', style: 'destructive', onPress: () => console.log('SOS Active') }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.trackerHeader}>
        <Text style={styles.rideId}>RIDE #{id}</Text>
        <View style={styles.statusIndicator}>
          <View style={styles.pulseDot} />
          <Text style={styles.statusText}>Live Telemetry</Text>
        </View>
      </View>

      {/* Mock Map Panel */}
      <View style={styles.mapMock}>
        <Text style={styles.mapText}>🗺️ Live Map Tracking Vector</Text>
        <Text style={styles.mapCoords}>Lat: {driverLocation.lat.toFixed(5)}  Lng: {driverLocation.lng.toFixed(5)}</Text>
        <Text style={styles.speedLabel}>{speed} km/h</Text>
      </View>

      {geofenceAlert ? (
        <View style={styles.alertBox}>
          <Text style={styles.alertText}>⚠️ GEOFENCE EXCURSION WARNING</Text>
          <Text style={styles.alertDesc}>{geofenceAlert}</Text>
        </View>
      ) : (
        <View style={styles.safeBox}>
          <Text style={styles.safeText}>✓ Ride normal: Within planned detour threshold</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.label}>Driver Info</Text>
        <Text style={styles.val}>Rajesh Kumar · Nexon EV (DL 3C BC 8712)</Text>
        <Text style={styles.label}>Pickup Coordinates</Text>
        <Text style={styles.val}>Sector 18 HDFC ATM (ETA 8:55 AM)</Text>
      </View>

      <TouchableOpacity style={styles.sosBtn} onPress={triggerSOS}>
        <Text style={styles.sosText}>🚨 TRIGGER EMERGENCY SOS</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backText}>Return to Home</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080c14',
    padding: 16,
  },
  trackerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 14,
  },
  rideId: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginRight: 6,
  },
  statusText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '700',
  },
  mapMock: {
    backgroundColor: '#121b2d',
    borderRadius: 12,
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f2d47',
    marginBottom: 16,
    position: 'relative',
  },
  mapText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  mapCoords: {
    color: '#9ca3af',
    fontSize: 11,
    marginTop: 6,
  },
  speedLabel: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    color: '#ff6b35',
    fontWeight: '800',
    fontSize: 18,
  },
  alertBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
    marginBottom: 16,
  },
  alertText: {
    color: '#ef4444',
    fontWeight: '800',
    fontSize: 12,
    textAlign: 'center',
  },
  alertDesc: {
    color: '#ef4444',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },
  safeBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#10b981',
    marginBottom: 16,
  },
  safeText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#121b2d',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1f2d47',
    marginBottom: 20,
  },
  label: {
    fontSize: 10,
    color: '#9ca3af',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  val: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 12,
  },
  sosBtn: {
    backgroundColor: '#ef4444',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  sosText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 14,
  },
  backBtn: {
    borderWidth: 1,
    borderColor: '#1f2d47',
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backText: {
    color: '#9ca3af',
    fontWeight: '700',
  }
});
