import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Dimensions, TextInput, Switch, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Lock, FileText, CheckCircle, PlusCircle, Activity, Navigation, MapPin, Calendar, Users, X, Check, Car, Bike, Shield } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { apiFetch } from '../services/api';
import auth from '@react-native-firebase/auth';
import io from 'socket.io-client';
import { API_URL } from '../services/api';

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

export default function DriverInterface() {
  const router = useRouter();
  const [kycLevel2Complete, setKycLevel2Complete] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'drive'>('overview');
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const telemetryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ride posting form states
  const [showPostModal, setShowPostModal] = useState(false);
  const [destination, setDestination] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [vehicleType, setVehicleType] = useState<'CAR' | 'BIKE'>('CAR');
  const [isRecurring, setIsRecurring] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [acAvailable, setAcAvailable] = useState(true);
  const [musicAllowed, setMusicAllowed] = useState(true);
  const [smokingAllowed, setSmokingAllowed] = useState(false);
  const [chattiness, setChattiness] = useState<'QUIET' | 'MEDIUM' | 'TALKATIVE'>('MEDIUM');
  const [suggestedPrice, setSuggestedPrice] = useState<number | null>(null);
  const [customPrice, setCustomPrice] = useState('');
  const [activeRideId, setActiveRideId] = useState<string | null>(null);

  // Calculate suggested pricing on the fly
  useEffect(() => {
    const dist = parseFloat(distanceKm);
    if (!isNaN(dist) && dist > 0) {
      const baseRate = vehicleType === 'BIKE' ? 6 : 12;
      const acAddon = (vehicleType === 'CAR' && acAvailable) ? 2 : 0;
      const rate = baseRate + acAddon;
      const suggested = dist * rate;
      setSuggestedPrice(suggested);
      setCustomPrice(suggested.toString());
    } else {
      setSuggestedPrice(null);
      setCustomPrice('');
    }
  }, [distanceKm, vehicleType, acAvailable]);

  // Connect Socket.IO and broadcast simulated telemetry when online
  useEffect(() => {
    if (!isOnline || !activeRideId) {
      // Clean up socket and interval when going offline
      if (telemetryIntervalRef.current) clearInterval(telemetryIntervalRef.current);
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    let cancelled = false;
    (async () => {
      const token = await auth().currentUser?.getIdToken();
      if (cancelled) return;

      const socket = io(API_URL, { auth: { token } });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('ride:join', activeRideId);
        // Simulated GPS: increments slightly each tick (replace with expo-location for real GPS)
        let lat = 28.4231, lng = 77.0872;
        telemetryIntervalRef.current = setInterval(() => {
          lat += 0.0001 * (Math.random() - 0.5);
          lng += 0.0002;
          socket.emit('telemetry:update', {
            userId: auth().currentUser?.uid,
            lat, lng,
            speed: Math.round(30 + Math.random() * 20),
            bearing: 90,
            rideId: activeRideId,
          });
        }, 5000);
      });
    })();

    return () => {
      cancelled = true;
      if (telemetryIntervalRef.current) clearInterval(telemetryIntervalRef.current);
      socketRef.current?.disconnect();
    };
  }, [isOnline, activeRideId]);

  const toggleDay = (dayIndex: number) => {
    if (selectedDays.includes(dayIndex)) {
      setSelectedDays(selectedDays.filter(d => d !== dayIndex));
    } else {
      setSelectedDays([...selectedDays, dayIndex]);
    }
  };

  const handlePostRide = async () => {
    if (!destination || !distanceKm) {
      Alert.alert('Error', 'Please fill in the destination and estimated distance.');
      return;
    }
    setIsPosting(true);
    try {
      const res = await apiFetch('/api/rides', {
        method: 'POST',
        body: JSON.stringify({
          destination,
          distance_km: parseFloat(distanceKm),
          vehicle_type: vehicleType,
          price_per_seat: parseFloat(customPrice) || suggestedPrice || 100,
          is_recurring: isRecurring,
          recurring_days: selectedDays,
          ac_available: acAvailable,
          music_allowed: musicAllowed,
          smoking_allowed: smokingAllowed,
          chattiness,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Alert.alert('Failed to Post Ride', err.error || `Server error ${res.status}`);
        return;
      }
      const ride = await res.json();
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

  // Locked State for Passengers trying to access Driver features
  if (!kycLevel2Complete) {
    return (
      <View style={styles.lockedContainer}>
        <View style={styles.lockedIconBox}>
          <Lock color={colors.primary} size={48} />
        </View>
        <Text style={styles.lockedTitle}>Upgrade Required</Text>
        <Text style={styles.lockedSub}>You must complete Level 2 KYC to unlock driver features and start earning.</Text>
        
        <View style={styles.requirementList}>
          <View style={styles.reqItem}>
            <CheckCircle color={colors.success} size={20} />
            <Text style={styles.reqText}>Level 1: Phone & Selfie (Completed)</Text>
          </View>
          <View style={styles.reqItem}>
            <FileText color={colors.textMuted} size={20} />
            <Text style={[styles.reqText, { color: colors.textMuted }]}>Level 2: Govt ID & License (Pending)</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.upgradeBtn} onPress={() => setKycLevel2Complete(true)}>
          <Text style={styles.upgradeBtnText}>Complete Verification Now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Unlocked Driver State
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Driver Dashboard</Text>
        <TouchableOpacity 
          style={[styles.onlineToggle, isOnline ? styles.onlineActive : styles.onlineInactive]}
          onPress={() => setIsOnline(!isOnline)}
        >
          <View style={[styles.onlineDot, isOnline ? { backgroundColor: 'white' } : { backgroundColor: colors.textMuted }]} />
          <Text style={[styles.onlineText, isOnline ? { color: 'white' } : { color: colors.textMuted }]}>
            {isOnline ? 'Online' : 'Go Online'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Top Segmented Control */}
      <View style={styles.segmentedControl}>
        <TouchableOpacity style={[styles.segmentBtn, activeTab === 'overview' && styles.segmentActive]} onPress={() => setActiveTab('overview')}>
          <Text style={[styles.segmentText, activeTab === 'overview' && styles.segmentTextActive]}>Overview</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentBtn, activeTab === 'requests' && styles.segmentActive]} onPress={() => setActiveTab('requests')}>
          <Text style={[styles.segmentText, activeTab === 'requests' && styles.segmentTextActive]}>Requests (2)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentBtn, activeTab === 'drive' && styles.segmentActive]} onPress={() => setActiveTab('drive')}>
          <Text style={[styles.segmentText, activeTab === 'drive' && styles.segmentTextActive]}>Drive</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {activeTab === 'overview' && !showPostModal && (
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Earnings Widget */}
            <View style={styles.earningsCard}>
              <Text style={styles.earningsLabel}>Earned this Week</Text>
              <Text style={styles.earningsAmount}>₹4,320</Text>
              <View style={styles.sparklineBox}>
                <Activity color={colors.success} size={20} />
                <Text style={styles.sparklineText}>+12% from last week</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.postRideBtn} onPress={() => setShowPostModal(true)}>
              <PlusCircle color="white" size={20} />
              <Text style={styles.postRideText}>Offer a New Ride</Text>
            </TouchableOpacity>

            <Text style={styles.sectionTitle}>My Upcoming Rides</Text>
            
            <View style={styles.upcomingCard}>
              <View style={styles.routeBox}>
                <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                  <Text style={styles.routeTime}>Today, 18:30</Text>
                  <View style={styles.badgeRow}>
                    <Text style={styles.miniBadge}>CAR</Text>
                    <Text style={styles.miniBadge}>RECURRING</Text>
                  </View>
                </View>
                <Text style={styles.routeDest}>Sector 44 → Vasant Kunj</Text>
              </View>
              <View style={styles.passengerBox}>
                <View style={styles.passengerAvatars}>
                  <View style={[styles.avatarMini, { zIndex: 3, backgroundColor: colors.cardBorder }]} />
                  <View style={[styles.avatarMini, { zIndex: 2, marginLeft: -10, backgroundColor: colors.cardBorder }]} />
                  <View style={[styles.avatarMini, { zIndex: 1, marginLeft: -10, backgroundColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{fontSize: 10, color: colors.textMuted}}>+1</Text>
                  </View>
                </View>
                <Text style={styles.seatText}>3/4 Seats Filled</Text>
              </View>
            </View>
          </ScrollView>
        )}

        {/* Post a New Ride Form Drawer (Togopool & BlaBlaCar Gaps) */}
        {activeTab === 'overview' && showPostModal && (
          <ScrollView showsVerticalScrollIndicator={false} style={styles.formContainer}>
            <View style={styles.formHeader}>
              <Text style={styles.formTitle}>Offer Commute Details</Text>
              <TouchableOpacity onPress={() => setShowPostModal(false)}>
                <X color={colors.textMuted} size={24} />
              </TouchableOpacity>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Office Destination</Text>
              <TextInput 
                style={styles.formInput} 
                placeholder="e.g. DLF Cyber City Building 10" 
                placeholderTextColor={colors.inputPlaceholder}
                value={destination}
                onChangeText={setDestination}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Route Length (Kms)</Text>
              <TextInput 
                style={styles.formInput} 
                keyboardType="numeric" 
                placeholder="e.g. 15" 
                placeholderTextColor={colors.inputPlaceholder}
                value={distanceKm}
                onChangeText={setDistanceKm}
              />
            </View>

            {/* Vehicle Mode (Togopool Bike vs Car Option Gap) */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Vehicle Mode</Text>
              <View style={styles.vehicleSelectRow}>
                <TouchableOpacity 
                  style={[styles.vehicleSelectBtn, vehicleType === 'CAR' && styles.vehicleSelectBtnActive]}
                  onPress={() => setVehicleType('CAR')}
                >
                  <Car color={vehicleType === 'CAR' ? '#fff' : colors.textMuted} size={18} style={{marginRight: 6}} />
                  <Text style={[styles.vehicleSelectBtnText, vehicleType === 'CAR' && styles.vehicleSelectBtnTextActive]}>Car Pool</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.vehicleSelectBtn, vehicleType === 'BIKE' && styles.vehicleSelectBtnActive]}
                  onPress={() => setVehicleType('BIKE')}
                >
                  <Bike color={vehicleType === 'BIKE' ? '#fff' : colors.textMuted} size={18} style={{marginRight: 6}} />
                  <Text style={[styles.vehicleSelectBtnText, vehicleType === 'BIKE' && styles.vehicleSelectBtnTextActive]}>Bike Pool</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Smart Pricing Suggestion (BlaBlaCar Smart Pricing Gap) */}
            {suggestedPrice !== null && (
              <View style={styles.pricingCard}>
                <Text style={styles.pricingTitle}>Smart Pricing Recommendation</Text>
                <Text style={styles.pricingSub}>Suggested fuel contribution based on distance and mode:</Text>
                <Text style={styles.pricingSuggested}>₹{suggestedPrice.toFixed(0)}</Text>
                <View style={styles.priceInputGroup}>
                  <Text style={styles.priceInputLabel}>Your Split Cost (₹):</Text>
                  <TextInput 
                    style={styles.priceInput}
                    keyboardType="numeric"
                    value={customPrice}
                    onChangeText={setCustomPrice}
                  />
                </View>
              </View>
            )}

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
                    <TouchableOpacity 
                      key={day} 
                      style={[styles.dayChip, active && styles.dayChipActive]}
                      onPress={() => toggleDay(idx)}
                    >
                      <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>{day}</Text>
                    </TouchableOpacity>
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

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Chattiness Level</Text>
              <View style={styles.chatSelectRow}>
                {(['QUIET', 'MEDIUM', 'TALKATIVE'] as const).map(level => {
                  const active = chattiness === level;
                  return (
                    <TouchableOpacity 
                      key={level} 
                      style={[styles.chatBtn, active && styles.chatBtnActive]}
                      onPress={() => setChattiness(level)}
                    >
                      <Text style={[styles.chatBtnText, active && styles.chatBtnTextActive]}>{level}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <TouchableOpacity style={styles.submitBtn} onPress={handlePostRide}>
              <Text style={styles.submitBtnText}>Post Commute Route</Text>
            </TouchableOpacity>
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
                  <TouchableOpacity style={styles.declineBtn}><X color="#ef4444" size={24} /></TouchableOpacity>
                  <TouchableOpacity style={styles.acceptBtn}><Check color="#fff" size={24} /><Text style={styles.acceptText}>Accept Rider</Text></TouchableOpacity>
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

            <TouchableOpacity style={styles.hugeActionBtn}>
              <Text style={styles.hugeActionText}>Passenger Picked Up</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
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
  passengerBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  passengerAvatars: { flexDirection: 'row' },
  avatarMini: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.card },
  seatText: { color: colors.textMuted, fontWeight: '500', fontSize: 14 },
  badgeRow: { flexDirection: 'row', gap: 6 },
  miniBadge: { fontSize: 9, color: colors.primary, backgroundColor: 'rgba(255,107,53,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontWeight: 'bold' },

  lockedContainer: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 },
  lockedIconBox: { width: 96, height: 96, backgroundColor: 'rgba(255,107,53,0.15)', borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 24, borderWidth: 1, borderColor: 'rgba(255,107,53,0.3)' },
  lockedTitle: { fontSize: 24, fontWeight: '900', color: colors.text, marginBottom: 8 },
  lockedSub: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  requirementList: { width: '100%', backgroundColor: colors.inputBackground, borderRadius: 16, padding: 16, gap: 16, marginBottom: 32, borderWidth: 1, borderColor: colors.cardBorder },
  reqItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reqText: { fontSize: 14, fontWeight: '600', color: colors.text },
  upgradeBtn: { backgroundColor: colors.primary, width: '100%', padding: 16, borderRadius: 16, alignItems: 'center' },
  upgradeBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  formContainer: { flex: 1, backgroundColor: colors.card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: colors.cardBorder },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  formTitle: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  formGroup: { marginBottom: 16 },
  formLabel: { fontSize: 13, color: colors.text, fontWeight: 'bold', marginBottom: 8 },
  formSubLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  formInput: { backgroundColor: colors.inputBackground, borderRadius: 8, height: 44, paddingHorizontal: 12, color: colors.text, borderWidth: 1, borderColor: colors.cardBorder },
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
