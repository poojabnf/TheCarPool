import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Lock, FileText, CheckCircle, PlusCircle, Activity, Navigation, MapPin, Calendar, Users, X, Check } from 'lucide-react-native';

export default function DriverInterface() {
  const router = useRouter();
  const [kycLevel2Complete, setKycLevel2Complete] = useState(false); // Simulate KYC Lock
  const [isOnline, setIsOnline] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'drive'>('overview');

  // Locked State for Passengers trying to access Driver features
  if (!kycLevel2Complete) {
    return (
      <View style={styles.lockedContainer}>
        <View style={styles.lockedIconBox}>
          <Lock color="#0f766e" size={48} />
        </View>
        <Text style={styles.lockedTitle}>Upgrade Required</Text>
        <Text style={styles.lockedSub}>You must complete Level 2 KYC to unlock driver features and start earning.</Text>
        
        <View style={styles.requirementList}>
          <View style={styles.reqItem}>
            <CheckCircle color="#10b981" size={20} />
            <Text style={styles.reqText}>Level 1: Phone & Selfie (Completed)</Text>
          </View>
          <View style={styles.reqItem}>
            <FileText color="#94a3b8" size={20} />
            <Text style={[styles.reqText, { color: '#64748b' }]}>Level 2: Govt ID & License (Pending)</Text>
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
          <View style={[styles.onlineDot, isOnline ? { backgroundColor: 'white' } : { backgroundColor: '#64748b' }]} />
          <Text style={[styles.onlineText, isOnline ? { color: 'white' } : { color: '#64748b' }]}>
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
        {activeTab === 'overview' && (
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Earnings Widget */}
            <View style={styles.earningsCard}>
              <Text style={styles.earningsLabel}>Earned this Week</Text>
              <Text style={styles.earningsAmount}>₹4,320</Text>
              <View style={styles.sparklineBox}>
                <Activity color="#0f766e" size={20} />
                <Text style={styles.sparklineText}>+12% from last week</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.postRideBtn}>
              <PlusCircle color="white" size={20} />
              <Text style={styles.postRideText}>Post a New Ride</Text>
            </TouchableOpacity>

            <Text style={styles.sectionTitle}>My Upcoming Rides</Text>
            
            <View style={styles.upcomingCard}>
              <View style={styles.routeBox}>
                <Text style={styles.routeTime}>Today, 18:30</Text>
                <Text style={styles.routeDest}>Sector 44 → Vasant Kunj</Text>
              </View>
              <View style={styles.passengerBox}>
                <View style={styles.passengerAvatars}>
                  <View style={[styles.avatarMini, { zIndex: 3, backgroundColor: '#cbd5e1' }]} />
                  <View style={[styles.avatarMini, { zIndex: 2, marginLeft: -10, backgroundColor: '#94a3b8' }]} />
                  <View style={[styles.avatarMini, { zIndex: 1, marginLeft: -10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{fontSize: 10, color: '#64748b'}}>+1</Text>
                  </View>
                </View>
                <Text style={styles.seatText}>3/4 Seats Filled</Text>
              </View>
            </View>
          </ScrollView>
        )}

        {activeTab === 'requests' && (
          <ScrollView showsVerticalScrollIndicator={false}>
            {[1, 2].map((req, i) => (
              <View key={i} style={styles.requestCard}>
                <View style={styles.reqHeader}>
                  <View style={styles.reqAvatar} />
                  <View>
                    <Text style={styles.reqName}>Amit Sharma</Text>
                    <Text style={styles.reqRating}>★ 4.8 • 2 mutual connections</Text>
                  </View>
                </View>
                <View style={styles.reqRoute}>
                  <Text style={styles.reqRouteText}>Pickup: IFFCO Chowk</Text>
                  <Text style={styles.reqRouteText}>Drop: Ambience Mall</Text>
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
              <Navigation color="#10b981" size={28} />
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
  container: { flex: 1, backgroundColor: '#f8fafc', paddingTop: 50 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 },
  headerTitle: { fontSize: 24, fontWeight: '900', color: '#0f172a' },
  
  onlineToggle: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, gap: 6, borderWidth: 1 },
  onlineActive: { backgroundColor: '#10b981', borderColor: '#10b981' },
  onlineInactive: { backgroundColor: '#f1f5f9', borderColor: '#cbd5e1' },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  onlineText: { fontWeight: 'bold', fontSize: 12 },

  segmentedControl: { flexDirection: 'row', backgroundColor: '#e2e8f0', marginHorizontal: 20, borderRadius: 12, padding: 4, marginBottom: 20 },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  segmentActive: { backgroundColor: 'white', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4 },
  segmentText: { fontWeight: '600', color: '#64748b' },
  segmentTextActive: { color: '#0f172a' },

  content: { flex: 1, paddingHorizontal: 20 },

  earningsCard: { backgroundColor: 'white', padding: 24, borderRadius: 24, marginBottom: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10 },
  earningsLabel: { color: '#64748b', fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase' },
  earningsAmount: { fontSize: 42, fontWeight: '900', color: '#0f172a', marginVertical: 8 },
  sparklineBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f0fdf4', padding: 8, borderRadius: 8, alignSelf: 'flex-start' },
  sparklineText: { color: '#15803d', fontWeight: 'bold', fontSize: 12 },

  postRideBtn: { backgroundColor: '#0f766e', padding: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 32 },
  postRideText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#0f172a', marginBottom: 16 },
  upcomingCard: { backgroundColor: 'white', borderRadius: 20, padding: 16, borderLeftWidth: 4, borderLeftColor: '#0f766e', shadowColor: '#000', shadowOpacity: 0.05 },
  routeBox: { marginBottom: 16 },
  routeTime: { color: '#0f766e', fontWeight: 'bold', marginBottom: 4 },
  routeDest: { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  passengerBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  passengerAvatars: { flexDirection: 'row' },
  avatarMini: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'white' },
  seatText: { color: '#64748b', fontWeight: '500', fontSize: 14 },

  lockedContainer: { flex: 1, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', padding: 32 },
  lockedIconBox: { width: 96, height: 96, backgroundColor: '#ccfbf1', borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  lockedTitle: { fontSize: 24, fontWeight: '900', color: '#0f172a', marginBottom: 8 },
  lockedSub: { fontSize: 16, color: '#64748b', textAlign: 'center', marginBottom: 32, lineHeight: 24 },
  requirementList: { width: '100%', backgroundColor: 'white', borderRadius: 16, padding: 16, gap: 16, marginBottom: 32 },
  reqItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reqText: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  upgradeBtn: { backgroundColor: '#0f766e', width: '100%', padding: 16, borderRadius: 16, alignItems: 'center' },
  upgradeBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  requestCard: { backgroundColor: 'white', padding: 20, borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  reqHeader: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  reqAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#cbd5e1' },
  reqName: { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  reqRating: { color: '#64748b', fontSize: 13, marginTop: 4 },
  reqRoute: { backgroundColor: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 16 },
  reqRouteText: { color: '#475569', fontSize: 14, marginBottom: 4 },
  actionRow: { flexDirection: 'row', gap: 12 },
  declineBtn: { width: 60, height: 50, borderRadius: 12, borderWidth: 2, borderColor: '#ef4444', alignItems: 'center', justifyContent: 'center' },
  acceptBtn: { flex: 1, height: 50, backgroundColor: '#10b981', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  acceptText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  driveContainer: { flex: 1, justifyContent: 'space-between', paddingBottom: 40 },
  driveHeader: { alignItems: 'center', marginTop: 20, marginBottom: 40 },
  driveTitle: { fontSize: 24, fontWeight: 'bold', color: '#0f172a', marginTop: 12 },
  driveEta: { fontSize: 18, color: '#10b981', fontWeight: 'bold', marginTop: 4 },
  stopList: { flex: 1 },
  stopItemActive: { backgroundColor: '#dcfce7', padding: 20, borderRadius: 16, borderWidth: 2, borderColor: '#10b981', marginBottom: 12 },
  stopLabel: { color: '#15803d', fontWeight: 'bold', fontSize: 12, marginBottom: 4 },
  stopItem: { backgroundColor: 'white', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12 },
  stopLocation: { color: '#0f172a', fontSize: 16, fontWeight: '600' },
  hugeActionBtn: { backgroundColor: '#10b981', height: 80, borderRadius: 20, alignItems: 'center', justifyContent: 'center', shadowColor: '#10b981', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: {width: 0, height: 5} },
  hugeActionText: { color: 'white', fontSize: 22, fontWeight: 'bold' }
});
