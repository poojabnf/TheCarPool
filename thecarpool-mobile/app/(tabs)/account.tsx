import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Wallet, CreditCard, Settings, HelpCircle, ChevronRight } from 'lucide-react-native';

export default function AccountInterface() {
  const [activeView, setActiveView] = useState<'menu' | 'wallet' | 'payments' | 'settings' | 'help'>('menu');

  if (activeView !== 'menu') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setActiveView('menu')}><Text style={styles.backBtn}>← Back</Text></TouchableOpacity>
          <Text style={styles.headerTitle}>{activeView.charAt(0).toUpperCase() + activeView.slice(1)}</Text>
        </View>
        
        {activeView === 'wallet' && (
          <View style={{ padding: 20 }}>
            {/* Multi-Currency Toggle Mock */}
            <View style={styles.currencyToggle}>
              <TouchableOpacity style={[styles.currencyBtn, {backgroundColor: '#0f766e'}]}><Text style={{color: 'white', fontWeight: 'bold'}}>INR (₹)</Text></TouchableOpacity>
              <TouchableOpacity style={styles.currencyBtn}><Text style={{color: '#64748b', fontWeight: 'bold'}}>USD ($)</Text></TouchableOpacity>
              <TouchableOpacity style={styles.currencyBtn}><Text style={{color: '#64748b', fontWeight: 'bold'}}>EUR (€)</Text></TouchableOpacity>
            </View>

            <View style={styles.walletCard}>
              <Text style={styles.walletLabel}>Current Balance</Text>
              <Text style={styles.walletBalance}>₹1,250.00</Text>
              <TouchableOpacity style={styles.addFundsBtn}><Text style={styles.addFundsText}>+ Add Funds (UPI/Card)</Text></TouchableOpacity>
            </View>
          </View>
        )}

        {activeView === 'payments' && (
          <View style={{ padding: 20 }}>
            <View style={styles.paymentCard}>
              <CreditCard color="#10b981" size={24} style={{ marginBottom: 12 }} />
              <Text style={styles.paymentNumber}>•••• •••• •••• 4242</Text>
              <Text style={styles.paymentExpiry}>Expires 12/28</Text>
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.profileHeader}>
        <View style={styles.avatar} />
        <View>
          <Text style={styles.profileName}>Pooja Yadav</Text>
          <Text style={styles.profilePhone}>+91 9876543210</Text>
        </View>
      </View>

      {/* Carbon Tracker Leaderboard Widget */}
      <View style={styles.carbonWidget}>
        <Text style={styles.carbonTitle}>🌍 Global Impact</Text>
        <Text style={styles.carbonSub}>You've saved <Text style={{fontWeight: 'bold', color: '#0f766e'}}>24.5 kg CO₂</Text> this month!</Text>
        <Text style={styles.carbonRank}>🏆 Top 5% in New Delhi</Text>
      </View>

      <View style={styles.menuGroup}>
        <MenuRow icon={<Wallet color="#0f766e" />} title="Wallet & Multi-Currency" subtitle="₹1,250.00 available" onPress={() => setActiveView('wallet')} />
        <MenuRow icon={<CreditCard color="#0f766e" />} title="Payment Methods" subtitle="Local methods supported" onPress={() => setActiveView('payments')} />
      </View>

      <View style={styles.menuGroup}>
        <MenuRow icon={<Settings color="#64748b" />} title="Settings" subtitle="Profile, Notifications" onPress={() => setActiveView('settings')} />
        <MenuRow icon={<HelpCircle color="#0f766e" />} title="Help & Support" subtitle="FAQs, Contact Us" onPress={() => setActiveView('help')} />
      </View>

      <TouchableOpacity style={styles.logoutBtn}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function MenuRow({ icon, title, subtitle, onPress }: any) {
  return (
    <TouchableOpacity style={styles.menuRow} onPress={onPress}>
      <View style={styles.menuRowLeft}>
        <View style={styles.iconBox}>{icon}</View>
        <View>
          <Text style={styles.menuTitle}>{title}</Text>
          <Text style={styles.menuSub}>{subtitle}</Text>
        </View>
      </View>
      <ChevronRight color="#cbd5e1" size={20} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 },
  backBtn: { color: '#10b981', fontWeight: 'bold', fontSize: 16, width: 60 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: 'bold', marginRight: 60 },
  
  profileHeader: { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 16, marginBottom: 10 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#cbd5e1' },
  profileName: { fontSize: 24, fontWeight: 'bold', color: '#0f172a' },
  profilePhone: { fontSize: 14, color: '#64748b', marginTop: 4 },

  menuGroup: { backgroundColor: 'white', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#e2e8f0', marginBottom: 24 },
  menuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  menuRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  iconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' },
  menuTitle: { fontSize: 16, fontWeight: 'bold', color: '#0f172a' },
  menuSub: { fontSize: 13, color: '#64748b', marginTop: 2 },

  walletCard: { backgroundColor: 'white', padding: 24, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10 },
  walletLabel: { fontSize: 14, color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold', marginBottom: 8 },
  walletBalance: { fontSize: 48, fontWeight: 'bold', color: '#0f172a', marginBottom: 24 },
  addFundsBtn: { backgroundColor: '#10b981', padding: 16, borderRadius: 12, alignItems: 'center' },
  addFundsText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  paymentCard: { backgroundColor: 'white', padding: 24, borderRadius: 20, borderWidth: 2, borderColor: '#10b981' },
  paymentNumber: { fontSize: 18, fontWeight: 'bold', color: '#0f172a', marginBottom: 4 },
  paymentExpiry: { fontSize: 14, color: '#64748b' },

  logoutBtn: { marginHorizontal: 20, padding: 16, borderRadius: 12, backgroundColor: '#fee2e2', alignItems: 'center', marginTop: 20 },
  logoutText: { color: '#ef4444', fontWeight: 'bold', fontSize: 16 },

  carbonWidget: { backgroundColor: '#f0fdf4', margin: 20, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#bbf7d0', marginTop: 0 },
  carbonTitle: { fontWeight: 'bold', color: '#166534', fontSize: 16, marginBottom: 8 },
  carbonSub: { color: '#15803d', fontSize: 14, marginBottom: 12 },
  carbonRank: { backgroundColor: 'white', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, fontSize: 12, fontWeight: 'bold', color: '#0f766e', overflow: 'hidden' },

  currencyToggle: { flexDirection: 'row', backgroundColor: '#f1f5f9', padding: 4, borderRadius: 12, marginBottom: 20 },
  currencyBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 }
});
