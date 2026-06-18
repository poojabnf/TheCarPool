import React, { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, ScrollView, TextInput, Alert, Platform } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

// From the 1.2.2 native build onward the Android Maps key is in the manifest,
// so the Google map renders on both platforms. (Older keyless 1.1.0 builds stay
// on their own JS via runtimeVersion separation, so they keep the placeholder.)
const MAPS_SUPPORTED = true;
import { useRouter } from 'expo-router';
import { ShieldAlert, UserCheck, Zap, Navigation, Shield, Phone, Music, Smile, Wind, Car, Bike } from 'lucide-react-native';
import { useAuthStore } from '../store/authStore';
import { apiFetch } from '../services/api';
import { colors } from '../../theme/colors';

const riderLocation = { latitude: 28.4610, longitude: 77.0280 };
const trendingRoutes = ["Sector 44 → Metro", "Cyber Hub → Vasant Kunj", "Airport T3"];

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

export default function RiderInterface() {
  const router = useRouter();
  const { kycStatus } = useAuthStore();
  const kycVerified = kycStatus === 'verified';
  const [searchMode, setSearchMode] = useState(false);
  const [activeTrip, setActiveTrip] = useState(false);
  const [womenSafetyMode, setWomenSafetyMode] = useState(false);
  
  // Custom filters
  const [vehicleFilter, setVehicleFilter] = useState<'ANY' | 'CAR' | 'BIKE'>('ANY');
  const [acFilter, setAcFilter] = useState(false);
  const [musicFilter, setMusicFilter] = useState(false);
  const [smokingFilter, setSmokingFilter] = useState(false);

  // Destination search ("Where are you going?")
  const [destination, setDestination] = useState('');
  const [destSuggestions, setDestSuggestions] = useState<any[]>([]);
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [rideResults, setRideResults] = useState<any[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Rider's real GPS location, used as the pickup origin (falls back to the
  // default region until permission is granted / a fix is acquired).
  const [userLoc, setUserLoc] = useState({ latitude: riderLocation.latitude, longitude: riderLocation.longitude });

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLoc({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      } catch {
        /* keep default location */
      }
    })();
  }, []);

  const fetchDestSuggestions = async (q: string) => {
    setDestination(q);
    if (q.trim().length < 2) { setDestSuggestions([]); return; }
    try {
      const res = await apiFetch(`/api/geo/search?query=${encodeURIComponent(q)}`);
      const data = res.ok ? await res.json() : [];
      setDestSuggestions(Array.isArray(data) ? data : []);
    } catch {
      setDestSuggestions([]);
    }
  };

  // Mock list with competitor differentiator values
  const mockRides = [
    {
      id: 1,
      driver_name: "Amit Sharma",
      is_verified: true,
      rating: "4.9 (120 trips)",
      price: 120,
      vehicle_make: "Tata Nexon EV (White)",
      vehicle_type: "CAR",
      match_score: "95% Match",
      ac_available: true,
      music_allowed: true,
      smoking_allowed: false,
      chattiness: "MEDIUM",
      linkedin_connections: 184,
      mutual_count: 2,
    },
    {
      id: 2,
      driver_name: "Neha Goel",
      is_verified: true,
      rating: "4.8 (42 trips)",
      price: 60,
      vehicle_make: "Ather 450X (Grey)",
      vehicle_type: "BIKE",
      match_score: "89% Match",
      ac_available: false,
      music_allowed: false,
      smoking_allowed: false,
      chattiness: "QUIET",
      linkedin_connections: 312,
      mutual_count: 5,
    },
    {
      id: 3,
      driver_name: "Rohan Kapoor",
      is_verified: true,
      rating: "4.7 (89 trips)",
      price: 135,
      vehicle_make: "Hyundai i20 (Red)",
      vehicle_type: "CAR",
      match_score: "82% Match",
      ac_available: true,
      music_allowed: true,
      smoking_allowed: true,
      chattiness: "TALKATIVE",
      linkedin_connections: 92,
      mutual_count: 1,
    }
  ];

  const filteredRides = mockRides.filter(ride => {
    if (vehicleFilter !== 'ANY' && ride.vehicle_type !== vehicleFilter) return false;
    if (acFilter && !ride.ac_available) return false;
    if (musicFilter && !ride.music_allowed) return false;
    if (smokingFilter && ride.smoking_allowed) return false;
    return true;
  });

  // Browsing is open to everyone — search, prices, and listings are visible
  // without verification. Verification is only required to book (see handleBook).
  // Uses the selected destination's coordinates to query real matching rides.
  const handleFindRides = async () => {
    setSearchMode(true);
    if (!destCoords) {
      setRideResults(null); // no destination chosen → show sample rides
      return;
    }
    setIsSearching(true);
    try {
      const res = await apiFetch('/api/rides/search', {
        method: 'POST',
        body: JSON.stringify({
          pickup_lat: userLoc.latitude,
          pickup_lng: userLoc.longitude,
          drop_lat: destCoords.lat,
          drop_lng: destCoords.lng,
          max_detour_meters: 1500,
        }),
      });
      const data = res.ok ? await res.json() : [];
      setRideResults(Array.isArray(data) ? data : []);
    } catch {
      setRideResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Gate the actual booking on KYC verification.
  const handleBook = (ride: any) => {
    if (!kycVerified) {
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
    router.push('/components/KycUploadModal');
    setActiveTrip(true);
  };

  return (
    <View style={styles.container}>
      {/* Map background — Google map on iOS; placeholder on Android until a
          native build ships the Maps key (avoids the keyless-launch crash). */}
      {MAPS_SUPPORTED ? (
        <MapView
          style={styles.map}
          region={{ ...userLoc, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        >
          <Marker coordinate={userLoc} title="You" pinColor={colors.primary} />
        </MapView>
      ) : (
        <View style={[styles.map, { backgroundColor: colors.card }]} />
      )}

      {/* Floating Header */}
      <View style={styles.topArea}>
        <View style={styles.header}>
          <View style={styles.logoBox}><Text style={styles.logoText}>T</Text></View>
          <Text style={styles.headerTitle}>TheCar<Text style={{color: colors.primary}}>Pool</Text></Text>
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

      {/* In-Ride Safety Overlay */}
      {activeTrip && (
        <View style={styles.safetyOverlay}>
          <View style={styles.tripStatus}>
            <Navigation color={colors.primary} size={24} />
            <View>
              <Text style={styles.tripStatusTitle}>En Route to Cyber Hub</Text>
              <Text style={styles.tripStatusSub}>ETA: 12 mins • Route is nominal</Text>
            </View>
          </View>
          
          <View style={styles.safetyActions}>
            <TouchableOpacity style={styles.shareBtn}>
              <UserCheck color={colors.primary} size={20} />
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
            // Standard Search & Filter Config View (Togopool & sRide Gaps)
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
                <TextInput
                  style={styles.input}
                  value={destination}
                  onChangeText={fetchDestSuggestions}
                  placeholder="Search destination…"
                  placeholderTextColor={colors.textMuted}
                  autoCorrect={false}
                />
                {destSuggestions.length > 0 && (
                  <View style={styles.suggestionsBox}>
                    {destSuggestions.slice(0, 6).map((s, i) => (
                      <TouchableOpacity
                        key={i}
                        style={styles.suggestionItem}
                        onPress={() => {
                          setDestination(`${s.place_name}${s.postal_code ? ` (${s.postal_code})` : ''}`);
                          setDestCoords({ lat: s.latitude ?? s.lat ?? 0, lng: s.longitude ?? s.lng ?? 0 });
                          setDestSuggestions([]);
                        }}
                      >
                        <Text style={styles.suggestionText} numberOfLines={1}>
                          {s.place_name}{s.state_name ? `, ${s.state_name}` : ''}{s.country_name ? `, ${s.country_name}` : ''}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Vehicle Type Filter (Togopool Bike vs Car Gap) */}
              <Text style={styles.sectionTitle}>Ride Mode</Text>
              <View style={styles.vehicleFilterRow}>
                <TouchableOpacity 
                  style={[styles.filterChip, vehicleFilter === 'ANY' && styles.filterChipActive]}
                  onPress={() => setVehicleFilter('ANY')}
                >
                  <Text style={[styles.filterChipText, vehicleFilter === 'ANY' && styles.filterChipTextActive]}>Any</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.filterChip, vehicleFilter === 'CAR' && styles.filterChipActive]}
                  onPress={() => setVehicleFilter('CAR')}
                >
                  <Car color={vehicleFilter === 'CAR' ? '#fff' : colors.textMuted} size={16} style={{marginRight: 4}} />
                  <Text style={[styles.filterChipText, vehicleFilter === 'CAR' && styles.filterChipTextActive]}>Car Pool</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.filterChip, vehicleFilter === 'BIKE' && styles.filterChipActive]}
                  onPress={() => setVehicleFilter('BIKE')}
                >
                  <Bike color={vehicleFilter === 'BIKE' ? '#fff' : colors.textMuted} size={16} style={{marginRight: 4}} />
                  <Text style={[styles.filterChipText, vehicleFilter === 'BIKE' && styles.filterChipTextActive]}>Bike Pool</Text>
                </TouchableOpacity>
              </View>

              {/* Granular Commute Preferences (Togopool Gap) */}
              <Text style={styles.sectionTitle}>Commute Preferences</Text>
              <View style={styles.prefsRow}>
                <TouchableOpacity 
                  style={[styles.prefToggle, acFilter && styles.prefToggleActive]} 
                  onPress={() => setAcFilter(!acFilter)}
                >
                  <Wind size={14} color={acFilter ? '#fff' : colors.textMuted} style={{marginRight: 4}} />
                  <Text style={[styles.prefToggleText, acFilter && styles.prefToggleTextActive]}>AC Only</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.prefToggle, musicFilter && styles.prefToggleActive]} 
                  onPress={() => setMusicFilter(!musicFilter)}
                >
                  <Music size={14} color={musicFilter ? '#fff' : colors.textMuted} style={{marginRight: 4}} />
                  <Text style={[styles.prefToggleText, musicFilter && styles.prefToggleTextActive]}>Music Okay</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.prefToggle, smokingFilter && styles.prefToggleActive]} 
                  onPress={() => setSmokingFilter(!smokingFilter)}
                >
                  <Text style={[styles.prefToggleText, smokingFilter && styles.prefToggleTextActive]}>🚭 No Smoking</Text>
                </TouchableOpacity>
              </View>
              
              <Text style={styles.sectionTitle}>Trending Routes</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
                {trendingRoutes.map(route => (
                  <View key={route} style={styles.chip}><Zap color="#f59e0b" size={14} /><Text style={styles.chipText}>{route}</Text></View>
                ))}
              </ScrollView>

              {/* KYC Banner */}
              {!kycVerified && (
                <TouchableOpacity
                  style={styles.kycBanner}
                  onPress={() => router.push('/onboarding')}
                  activeOpacity={0.85}
                >
                  <Shield color={colors.primary} size={18} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.kycBannerTitle}>Complete KYC to book rides</Text>
                    <Text style={styles.kycBannerSub}>Aadhaar + PAN + Selfie required → Takes 2 mins</Text>
                  </View>
                  <Text style={styles.kycBannerArrow}>→</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.searchButton} onPress={handleFindRides}>
                <Text style={styles.searchButtonText}>
                  Find Rides
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Search Results Feed (sRide & BlaBlaCar Gaps)
            <View style={styles.feedContainer}>
              <View style={styles.feedHeader}>
                <Text style={styles.feedTitle}>Available Rides</Text>
                <TouchableOpacity onPress={() => setSearchMode(false)}><Text style={styles.closeText}>Back to Filters</Text></TouchableOpacity>
              </View>
              
              <ScrollView showsVerticalScrollIndicator={false}>
                {isSearching && <Text style={styles.searchingText}>Searching rides to your destination…</Text>}

                {/* Real rides matched to the selected destination */}
                {rideResults && rideResults.length > 0 && rideResults.map((r) => (
                  <View key={`real-${r.id}`} style={styles.rideCard}>
                    <View style={styles.cardHeader}>
                      <View style={styles.driverInfo}>
                        <View style={styles.avatar} />
                        <View>
                          <Text style={styles.driverName}>{r.driver_name || 'Driver'} {r.is_ev ? '⚡ EV' : ''}</Text>
                          <Text style={styles.driverRating}>{r.seats_available} seats · ~{Math.round(r.pickup_deviation || 0)}m detour</Text>
                        </View>
                      </View>
                      <View style={styles.priceTag}><Text style={styles.priceText}>₹{r.price_split}</Text></View>
                    </View>
                    <TouchableOpacity style={[styles.bookButton, { marginTop: 12 }]} onPress={() => handleBook(r)}>
                      <Text style={styles.bookButtonText}>Confirm & Book</Text>
                    </TouchableOpacity>
                  </View>
                ))}

                {rideResults && rideResults.length === 0 && !isSearching && (
                  <Text style={styles.searchingText}>No live rides to that destination yet — showing sample rides.</Text>
                )}

                {/* Sample rides — shown when there are no live results */}
                {(!rideResults || rideResults.length === 0) && filteredRides.map((ride) => (
                  <View key={ride.id} style={styles.rideCard}>
                    <View style={styles.cardHeader}>
                      <View style={styles.driverInfo}>
                        <View style={styles.avatar} />
                        <View>
                          <Text style={styles.driverName}>{ride.driver_name} <Text style={styles.silverBadge}>🥈 Verified</Text></Text>
                          <Text style={styles.driverRating}>★ {ride.rating}</Text>
                        </View>
                      </View>
                      <View style={styles.priceTag}><Text style={styles.priceText}>₹{ride.price}</Text></View>
                    </View>

                    {/* LinkedIn Social Trust Badge (sRide Gap) */}
                    <View style={styles.linkedinBadge}>
                      <Linkedin size={14} color="#0077b5" style={{marginRight: 6}} />
                      <Text style={styles.linkedinText}>
                        LinkedIn Verified • {ride.mutual_count} mutual connections ({ride.linkedin_connections}+ connections)
                      </Text>
                    </View>
                    
                    <View style={styles.cardBody}>
                      <View style={styles.vehicleRow}>
                        {ride.vehicle_type === 'CAR' ? <Car color={colors.textMuted} size={16} /> : <Bike color={colors.textMuted} size={16} />}
                        <Text style={styles.vehicleText}>{ride.vehicle_make}</Text>
                      </View>
                      
                      {/* Driver Granular Preferences Icons (Togopool Gap) */}
                      <View style={styles.prefIconsRow}>
                        {ride.ac_available && <View style={styles.prefTag}><Wind size={12} color={colors.success} /><Text style={styles.prefTagText}>AC</Text></View>}
                        {ride.music_allowed && <View style={styles.prefTag}><Music size={12} color={colors.success} /><Text style={styles.prefTagText}>Music</Text></View>}
                        <View style={styles.prefTag}><Text style={styles.prefTagText}>🚭 No Smoking</Text></View>
                        <View style={styles.prefTag}><Smile size={12} color={colors.success} /><Text style={styles.prefTagText}>{ride.chattiness}</Text></View>
                      </View>

                      <View style={styles.matchScore}><Text style={styles.matchText}>{ride.match_score}</Text></View>
                    </View>

                    <View style={styles.cardActions}>
                      <TouchableOpacity style={styles.callBtn}>
                        <Phone color={colors.textMuted} size={18} />
                        <Text style={styles.callText}>Masked Call</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.bookButton} onPress={() => handleBook(ride)}>
                        <Text style={styles.bookButtonText}>Confirm & Book</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                {filteredRides.length === 0 && (
                  <Text style={styles.noMatchesText}>No matching rides found for these filter settings.</Text>
                )}
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  map: { width: Dimensions.get('window').width, height: Dimensions.get('window').height },
  
  topArea: { position: 'absolute', top: 50, left: 20, right: 20, gap: 12 },
  header: { backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.cardBorder },
  logoBox: { backgroundColor: colors.primary, width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: 'white', fontWeight: 'bold' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  
  upgradeBanner: { backgroundColor: colors.primary, padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 10 },
  bannerTitle: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  bannerSub: { color: '#ffedd5', fontSize: 12, marginTop: 2 },
  bannerArrow: { color: 'white', fontSize: 24, fontWeight: 'bold' },

  safetyOverlay: { position: 'absolute', bottom: 40, left: 20, right: 20, gap: 12 },
  tripStatus: { backgroundColor: colors.card, padding: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, borderWidth: 1, borderColor: colors.cardBorder },
  tripStatusTitle: { fontWeight: 'bold', fontSize: 16, color: colors.text },
  tripStatusSub: { color: colors.textMuted, fontSize: 12 },
  safetyActions: { flexDirection: 'row', gap: 12 },
  shareBtn: { flex: 1, backgroundColor: colors.card, padding: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.1, borderWidth: 1, borderColor: colors.cardBorder },
  shareText: { color: colors.text, fontWeight: 'bold' },
  sosBtn: { backgroundColor: '#ef4444', paddingHorizontal: 24, paddingVertical: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#ef4444', shadowOpacity: 0.4, shadowRadius: 10 },
  sosText: { color: 'white', fontWeight: 'bold', fontSize: 18 },

  bottomSheet: { position: 'absolute', bottom: 0, width: '100%', backgroundColor: colors.card, borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 24, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, minHeight: 320, borderWidth: 1, borderColor: colors.cardBorder },
  bottomSheetExpanded: { height: '85%' },
  dragger: { width: 40, height: 5, backgroundColor: colors.cardBorder, borderRadius: 5, alignSelf: 'center', marginBottom: 20 },
  
  searchContainer: { flex: 1 },
  womenSafetyToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#2d1b35', padding: 12, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: '#5c1b6d' },
  womenSafetyText: { color: '#f472b6', fontWeight: 'bold', fontSize: 14 },
  toggleSwitch: { width: 44, height: 24, borderRadius: 12, padding: 2 },
  toggleOn: { backgroundColor: '#e879f9' },
  toggleOff: { backgroundColor: colors.inputBackground },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'white' },
  knobOn: { transform: [{ translateX: 20 }] },
  knobOff: { transform: [{ translateX: 0 }] },

  inputBox: { backgroundColor: colors.inputBackground, padding: 12, borderRadius: 12, marginBottom: 16 },
  inputLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 4, fontWeight: 'bold' },
  input: { fontSize: 15, color: colors.text, height: 24, padding: 0 },
  suggestionsBox: { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  suggestionItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  suggestionText: { fontSize: 13, color: colors.text },
  searchingText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 12 },
  
  sectionTitle: { fontSize: 13, fontWeight: 'bold', color: colors.text, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  vehicleFilterRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  filterChip: { flex: 1, backgroundColor: colors.inputBackground, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { color: colors.textMuted, fontSize: 13, fontWeight: 'bold' },
  filterChipTextActive: { color: '#fff' },

  prefsRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  prefToggle: { flex: 1, backgroundColor: colors.inputBackground, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', borderWidth: 1, borderColor: colors.cardBorder },
  prefToggleActive: { backgroundColor: colors.success, borderColor: colors.success },
  prefToggleText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  prefToggleTextActive: { color: '#fff', fontWeight: 'bold' },

  chipsRow: { flexDirection: 'row', marginBottom: 24 },
  chip: { backgroundColor: '#2d2012', borderWidth: 1, borderColor: '#5c3e1b', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, marginRight: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 12, color: '#f59e0b', fontWeight: '600' },
  
  searchButton: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  searchButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  feedContainer: { flex: 1 },
  feedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  feedTitle: { fontSize: 20, fontWeight: 'bold', color: colors.text },
  closeText: { color: '#f87171', fontWeight: '600' },
  
  rideCard: { backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  driverInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.cardBorder },
  driverName: { fontSize: 16, fontWeight: 'bold', color: colors.text },
  silverBadge: { color: colors.primary, fontSize: 11, fontWeight: 'bold' },
  driverRating: { fontSize: 12, color: '#f59e0b', fontWeight: 'bold', marginTop: 2 },
  priceTag: { backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder },
  priceText: { fontWeight: 'bold', fontSize: 16, color: colors.success },
  
  linkedinBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,119,181,0.1)', padding: 8, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(0,119,181,0.25)' },
  linkedinText: { fontSize: 11, color: '#60a5fa', fontWeight: '500', flex: 1 },

  cardBody: { marginBottom: 16 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  vehicleText: { fontSize: 14, color: colors.text, fontWeight: '500' },
  
  prefIconsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  prefTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.card, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.cardBorder },
  prefTagText: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },

  matchScore: { backgroundColor: 'rgba(16,185,129,0.15)', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  matchText: { color: colors.success, fontSize: 12, fontWeight: 'bold' },
  
  cardActions: { flexDirection: 'row', gap: 10 },
  callBtn: { flex: 1, backgroundColor: colors.card, padding: 12, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.cardBorder },
  callText: { color: colors.textMuted, fontWeight: '600' },
  bookButton: { flex: 2, backgroundColor: colors.success, padding: 12, borderRadius: 10, alignItems: 'center' },
  bookButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  
  kycBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,107,53,0.08)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,107,53,0.25)', padding: 12, marginBottom: 12 },
  kycBannerTitle: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  kycBannerSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  kycBannerArrow: { color: colors.primary, fontSize: 18, fontWeight: '700' },

  noMatchesText: { color: colors.textMuted, textAlign: 'center', marginTop: 20, fontSize: 14 }
});
