import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, ScrollView, Image } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { ShieldAlert, UserCheck, Zap, Navigation, PhoneOff } from 'lucide-react-native';

const riderLocation = { latitude: 28.4610, longitude: 77.0280 };
const trendingRoutes = ["Sector 44 → Metro", "Cyber Hub → Vasant Kunj", "Airport T3"];

export default function RiderInterface() {
  const router = useRouter();
  const [searchMode, setSearchMode] = useState(false);
  const [activeTrip, setActiveTrip] = useState(false); // Simulates an active ride
  const [womenSafetyMode, setWomenSafetyMode] = useState(false);

  return (
    <View style={styles.container}>
      {/* Light Mode Map Background */}
      <MapView 
        style={styles.map} 
        provider={PROVIDER_GOOGLE}
        initialRegion={{ ...riderLocation, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      >
        <Marker coordinate={riderLocation} title="You" pinColor="#0f766e" />
      </MapView>

      {/* Floating Header & "Start Earning" Upgrade Banner */}
      <View style={styles.topArea}>
        <View style={styles.header}>
          <View style={styles.logoBox}><Text style={styles.logoText}>R</Text></View>
          <Text style={styles.headerTitle}>RideShare <Text style={styles.tealText}>Global</Text></Text>
        </View>

        {!activeTrip && (
          <TouchableOpacity style={styles.upgradeBanner} onPress={() => router.push('/driver')}>
            <View>
              <Text style={styles.bannerTitle}>Start Earning</Text>
              <Text style={styles.bannerSub}>Complete Level 2 KYC to offer rides.</Text>
            </View>
            <Text style={styles.bannerArrow}>→</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* In-Ride Safety Overlay (Only visible during active trip) */}
      {activeTrip && (
        <View style={styles.safetyOverlay}>
          <View style={styles.tripStatus}>
            <Navigation color="#0f766e" size={24} />
            <View>
              <Text style={styles.tripStatusTitle}>En Route to Cyber Hub</Text>
              <Text style={styles.tripStatusSub}>ETA: 12 mins • Route is nominal</Text>
            </View>
          </View>
          
          <View style={styles.safetyActions}>
            <TouchableOpacity style={styles.shareBtn}>
              <UserCheck color="#0f766e" size={20} />
              <Text style={styles.shareText}>Share Live Trip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sosBtn}>
              <ShieldAlert color="#fff" size={24} />
              <Text style={styles.sosText}>SOS</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Bottom Sheet Search & Feed */}
      {!activeTrip && (
        <View style={[styles.bottomSheet, searchMode ? styles.bottomSheetExpanded : null]}>
          <View style={styles.dragger} />
          
          {!searchMode ? (
            // Standard Search View
            <View style={styles.searchContainer}>
              <View style={styles.womenSafetyToggle}>
                <Text style={styles.womenSafetyText}>🌸 Women Safety Mode</Text>
                <TouchableOpacity 
                  style={[styles.toggleSwitch, womenSafetyMode ? styles.toggleOn : styles.toggleOff]} 
                  onPress={() => setWomenSafetyMode(!womenSafetyMode)}
                >
                  <View style={[styles.toggleKnob, womenSafetyMode ? styles.knobOn : styles.knobOff]} />
                </TouchableOpacity>
              </View>

              <View style={styles.inputBox}>
                <Text style={styles.inputLabel}>Where are you going?</Text>
                <Text style={styles.inputTextPlaceholder}>Search destination...</Text>
              </View>
              
              <Text style={styles.sectionTitle}>Trending Routes</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
                {trendingRoutes.map(route => (
                  <View key={route} style={styles.chip}><Zap color="#f59e0b" size={14} /><Text style={styles.chipText}>{route}</Text></View>
                ))}
              </ScrollView>

              <TouchableOpacity style={styles.searchButton} onPress={() => setSearchMode(true)}>
                <Text style={styles.searchButtonText}>Find Rides</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Search Results Feed
            <View style={styles.feedContainer}>
              <View style={styles.feedHeader}>
                <Text style={styles.feedTitle}>Available Rides</Text>
                <TouchableOpacity onPress={() => setSearchMode(false)}><Text style={styles.closeText}>Cancel</Text></TouchableOpacity>
              </View>
              
              <ScrollView showsVerticalScrollIndicator={false}>
                {[1, 2, 3].map((card, idx) => (
                  <View key={idx} style={styles.rideCard}>
                    <View style={styles.cardHeader}>
                      <View style={styles.driverInfo}>
                        <View style={styles.avatar} />
                        <View>
                          <Text style={styles.driverName}>Amit S. <Text style={styles.silverBadge}>🥈 ID Verified</Text></Text>
                          <Text style={styles.driverRating}>★ 4.9 (120 trips)</Text>
                        </View>
                      </View>
                      <View style={styles.priceTag}><Text style={styles.priceText}>₹120</Text></View>
                    </View>
                    
                    <View style={styles.cardBody}>
                      <Text style={styles.vehicleText}>Tata Nexon EV (White)</Text>
                      <View style={styles.matchScore}><Text style={styles.matchText}>95% Route Match</Text></View>
                    </View>

                    <View style={styles.cardActions}>
                      <TouchableOpacity style={styles.callBtn}>
                        <PhoneOff color="#64748b" size={18} />
                        <Text style={styles.callText}>Masked Call</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.bookButton} onPress={() => { router.push('/components/KycUploadModal'); setActiveTrip(true); }}>
                        <Text style={styles.bookButtonText}>Confirm & Book</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  map: { width: Dimensions.get('window').width, height: Dimensions.get('window').height },
  
  topArea: { position: 'absolute', top: 50, left: 20, right: 20, gap: 12 },
  header: { backgroundColor: 'white', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoBox: { backgroundColor: '#0f766e', width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: 'white', fontWeight: 'bold' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#1e293b' },
  tealText: { color: '#0f766e' },
  
  upgradeBanner: { backgroundColor: '#0f766e', padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: '#0f766e', shadowOpacity: 0.3, shadowRadius: 10 },
  bannerTitle: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  bannerSub: { color: '#ccfbf1', fontSize: 12, marginTop: 2 },
  bannerArrow: { color: 'white', fontSize: 24, fontWeight: 'bold' },

  safetyOverlay: { position: 'absolute', bottom: 40, left: 20, right: 20, gap: 12 },
  tripStatus: { backgroundColor: 'white', padding: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 },
  tripStatusTitle: { fontWeight: 'bold', fontSize: 16, color: '#0f172a' },
  tripStatusSub: { color: '#64748b', fontSize: 12 },
  safetyActions: { flexDirection: 'row', gap: 12 },
  shareBtn: { flex: 1, backgroundColor: 'white', padding: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.1 },
  shareText: { color: '#0f766e', fontWeight: 'bold' },
  sosBtn: { backgroundColor: '#ef4444', paddingHorizontal: 24, paddingVertical: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#ef4444', shadowOpacity: 0.4, shadowRadius: 10 },
  sosText: { color: 'white', fontWeight: 'bold', fontSize: 18 },

  bottomSheet: { position: 'absolute', bottom: 0, width: '100%', backgroundColor: 'white', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 24, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, minHeight: 300 },
  bottomSheetExpanded: { height: '85%' },
  dragger: { width: 40, height: 5, backgroundColor: '#cbd5e1', borderRadius: 5, alignSelf: 'center', marginBottom: 20 },
  
  searchContainer: { flex: 1 },
  womenSafetyToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fdf4ff', padding: 12, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: '#fbcfe8' },
  womenSafetyText: { color: '#c026d3', fontWeight: 'bold', fontSize: 14 },
  toggleSwitch: { width: 44, height: 24, borderRadius: 12, padding: 2 },
  toggleOn: { backgroundColor: '#c026d3' },
  toggleOff: { backgroundColor: '#cbd5e1' },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'white' },
  knobOn: { transform: [{ translateX: 20 }] },
  knobOff: { transform: [{ translateX: 0 }] },

  inputBox: { backgroundColor: '#f1f5f9', padding: 16, borderRadius: 12, marginBottom: 20 },
  inputLabel: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  inputTextPlaceholder: { fontSize: 16, color: '#94a3b8' },
  
  sectionTitle: { fontSize: 14, fontWeight: 'bold', color: '#0f172a', marginBottom: 12 },
  chipsRow: { flexDirection: 'row', marginBottom: 24 },
  chip: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, marginRight: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 12, color: '#b45309', fontWeight: '600' },
  
  searchButton: { backgroundColor: '#0f766e', padding: 16, borderRadius: 12, alignItems: 'center' },
  searchButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  feedContainer: { flex: 1 },
  feedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  feedTitle: { fontSize: 20, fontWeight: 'bold', color: '#0f172a' },
  closeText: { color: '#ef4444', fontWeight: '500' },
  
  rideCard: { backgroundColor: 'white', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  driverInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#cbd5e1' },
  driverName: { fontSize: 16, fontWeight: 'bold', color: '#0f172a' },
  silverBadge: { color: '#0f766e', fontSize: 12, fontWeight: 'normal' },
  driverRating: { fontSize: 12, color: '#f59e0b', fontWeight: 'bold', marginTop: 2 },
  priceTag: { backgroundColor: '#f1f5f9', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  priceText: { fontWeight: 'bold', fontSize: 16, color: '#0f172a' },
  cardBody: { marginBottom: 16 },
  vehicleText: { fontSize: 14, color: '#64748b', marginBottom: 8 },
  matchScore: { backgroundColor: '#ccfbf1', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  matchText: { color: '#0f766e', fontSize: 12, fontWeight: 'bold' },
  cardActions: { flexDirection: 'row', gap: 10 },
  callBtn: { flex: 1, backgroundColor: '#f1f5f9', padding: 12, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  callText: { color: '#475569', fontWeight: '600' },
  bookButton: { flex: 2, backgroundColor: '#0f766e', padding: 12, borderRadius: 10, alignItems: 'center' },
  bookButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 }
});
