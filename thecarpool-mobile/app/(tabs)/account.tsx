import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Switch, Alert, Linking, ActivityIndicator } from 'react-native';
import { Wallet, CreditCard, Settings, HelpCircle, ChevronRight, LogOut } from 'lucide-react-native';
import { auth } from '../services/firebase';
import { apiFetch } from '../services/api';

const SUPPORT_EMAIL = 'support@thecarpool.in';
const SUPPORT_PHONE = '+919999002281';
const PRIVACY_URL = 'https://thecarpool.in/privacy';

const PAYMENT_METHODS = [
  { key: 'wallet', icon: '👛', title: 'TheCarPool Wallet', subtitle: 'Pay from your in-app balance' },
  { key: 'upi', icon: '📲', title: 'UPI', subtitle: 'GPay, PhonePe, Paytm & more' },
  { key: 'netbanking', icon: '🏦', title: 'Net Banking', subtitle: 'All major banks' },
  { key: 'card', icon: '💳', title: 'Credit / Debit Card', subtitle: 'Visa, Mastercard, RuPay, Amex' },
];

const FAQS = [
  { q: 'How is the fare split calculated?', a: 'The trip cost is shared equally among co-passengers, with group discounts applied automatically for multiple seats.' },
  { q: 'Why do I need to verify (KYC)?', a: 'Verification keeps the community safe — every driver and rider confirms identity before booking a ride.' },
  { q: 'How does the SOS button work?', a: 'One tap alerts your emergency contacts with your live location during an active trip.' },
  { q: 'How do payouts reach drivers?', a: 'Fares are held in escrow and released to the driver’s UPI/account once the ride completes.' },
];

export default function AccountInterface() {
  const [activeView, setActiveView] = useState<'menu' | 'wallet' | 'payments' | 'settings' | 'help'>('menu');
  const [notifications, setNotifications] = useState(true);
  const [savingPref, setSavingPref] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState('wallet');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  // Wallet state
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [showTopUp, setShowTopUp] = useState(false);

  // Fetch real wallet balance when wallet view opens
  useEffect(() => {
    if (activeView !== 'wallet') return;
    const uid = auth().currentUser?.uid;
    if (!uid) return;
    setWalletLoading(true);
    Promise.all([
      apiFetch(`/api/payments/wallet/${uid}`).then(r => r.ok ? r.json() : null),
      apiFetch(`/api/payments/history/${uid}`).then(r => r.ok ? r.json() : []),
    ]).then(([wallet, history]) => {
      if (wallet) setWalletBalance(wallet.available_wallet_balance ?? 0);
      if (Array.isArray(history)) setTransactions(history.slice(0, 5));
    }).catch(() => {}).finally(() => setWalletLoading(false));
  }, [activeView]);

  const handleTopUp = () => {
    // Open Razorpay hosted checkout page in browser — OTA-safe, no native SDK needed
    Linking.openURL('https://rzp.io/l/thecarpool-topup').catch(() =>
      Alert.alert('Error', 'Could not open payment page.')
    );
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await auth().signOut();
            // onAuthStateChanged in _layout.tsx redirects to login automatically.
          } catch {
            Alert.alert('Error', 'Could not log out. Please try again.');
          }
        },
      },
    ]);
  };

  const toggleNotifications = async (value: boolean) => {
    setNotifications(value);
    setSavingPref(true);
    try {
      await apiFetch('/api/users/profile', {
        method: 'POST',
        body: JSON.stringify({ notifications_enabled: value }),
      });
    } catch {
      /* best-effort */
    } finally {
      setSavingPref(false);
    }
  };

  const handleDeleteAccount = () => {
    const uid = auth().currentUser?.uid;
    Alert.alert(
      'Delete Account',
      'This permanently erases your profile, rides, and bookings. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiFetch('/api/safety/account', {
                method: 'DELETE',
                body: JSON.stringify({ user_id: uid }),
              });
              await auth().signOut();
            } catch {
              Alert.alert('Error', 'Could not delete account. Please try again.');
            }
          },
        },
      ]
    );
  };

  if (activeView !== 'menu') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setActiveView('menu')}><Text style={styles.backBtn}>← Back</Text></TouchableOpacity>
          <Text style={styles.headerTitle}>
            {activeView === 'help' ? 'Help & Support' : activeView.charAt(0).toUpperCase() + activeView.slice(1)}
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20 }}>
          {activeView === 'wallet' && (
            <>
              <View style={styles.walletCard}>
                <Text style={styles.walletLabel}>Available Balance</Text>
                {walletLoading ? (
                  <ActivityIndicator color="#10b981" style={{ marginVertical: 8 }} />
                ) : (
                  <Text style={styles.walletBalance}>
                    ₹{walletBalance !== null ? walletBalance.toFixed(2) : '—'}
                  </Text>
                )}
                <TouchableOpacity style={styles.addFundsBtn} onPress={handleTopUp}>
                  <Text style={styles.addFundsText}>+ Add Funds via Razorpay</Text>
                </TouchableOpacity>
              </View>
              {transactions.length > 0 && (
                <View style={{ marginTop: 16 }}>
                  <Text style={[styles.sectionHint, { marginBottom: 8 }]}>Recent Transactions</Text>
                  {transactions.map((tx: any, i: number) => (
                    <View key={i} style={styles.methodRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.methodTitle}>{tx.description || tx.type || 'Transaction'}</Text>
                        <Text style={styles.methodSub}>{tx.created_at ? new Date(tx.created_at).toLocaleDateString() : ''}</Text>
                      </View>
                      <Text style={{ color: tx.amount > 0 ? '#10b981' : '#ef4444', fontWeight: '700' }}>
                        {tx.amount > 0 ? '+' : ''}₹{Math.abs(tx.amount || 0).toFixed(2)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}

          {activeView === 'payments' && (
            <>
              <Text style={styles.sectionHint}>Choose your default payment method</Text>
              {PAYMENT_METHODS.map((m) => (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.methodRow, selectedMethod === m.key && styles.methodRowActive]}
                  onPress={() => setSelectedMethod(m.key)}
                >
                  <Text style={styles.methodIcon}>{m.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodTitle}>{m.title}</Text>
                    <Text style={styles.methodSub}>{m.subtitle}</Text>
                  </View>
                  <View style={[styles.radio, selectedMethod === m.key && styles.radioOn]}>
                    {selectedMethod === m.key && <View style={styles.radioDot} />}
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.addMethodBtn} onPress={() => Alert.alert('Add payment method', 'You will be redirected to a secure Razorpay flow to add this method.')}>
                <Text style={styles.addMethodText}>+ Add a new payment method</Text>
              </TouchableOpacity>
            </>
          )}

          {activeView === 'settings' && (
            <>
              <View style={styles.settingRow}>
                <View>
                  <Text style={styles.settingTitle}>Push Notifications</Text>
                  <Text style={styles.settingSub}>Ride matches, updates & alerts</Text>
                </View>
                <Switch value={notifications} onValueChange={toggleNotifications} disabled={savingPref}
                  trackColor={{ true: '#10b981', false: '#cbd5e1' }} />
              </View>

              <TouchableOpacity style={styles.settingRow} onPress={() => Linking.openURL(PRIVACY_URL)}>
                <View><Text style={styles.settingTitle}>Privacy Policy</Text><Text style={styles.settingSub}>How we handle your data</Text></View>
                <ChevronRight color="#cbd5e1" size={20} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.settingRow} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
                <View><Text style={styles.settingTitle}>Contact Support</Text><Text style={styles.settingSub}>{SUPPORT_EMAIL}</Text></View>
                <ChevronRight color="#cbd5e1" size={20} />
              </TouchableOpacity>

              <View style={styles.settingRow}>
                <View><Text style={styles.settingTitle}>App Version</Text><Text style={styles.settingSub}>TheCarPool v1.2.5</Text></View>
              </View>

              <TouchableOpacity style={styles.dangerRow} onPress={handleDeleteAccount}>
                <Text style={styles.dangerText}>Delete My Account</Text>
              </TouchableOpacity>
            </>
          )}

          {activeView === 'help' && (
            <>
              <View style={styles.helpActions}>
                <TouchableOpacity style={styles.helpAction} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
                  <Text style={styles.helpActionIcon}>✉️</Text><Text style={styles.helpActionText}>Email Us</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.helpAction} onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}>
                  <Text style={styles.helpActionIcon}>📞</Text><Text style={styles.helpActionText}>Call Support</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.sectionHint}>Frequently asked questions</Text>
              {FAQS.map((f, i) => (
                <TouchableOpacity key={i} style={styles.faqRow} onPress={() => setOpenFaq(openFaq === i ? null : i)}>
                  <View style={styles.faqQRow}>
                    <Text style={styles.faqQ}>{f.q}</Text>
                    <Text style={styles.faqChevron}>{openFaq === i ? '−' : '+'}</Text>
                  </View>
                  {openFaq === i && <Text style={styles.faqA}>{f.a}</Text>}
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.profileHeader}>
        <View style={styles.avatar} />
        <View>
          <Text style={styles.profileName}>{auth().currentUser?.displayName || 'TheCarPool User'}</Text>
          <Text style={styles.profilePhone}>{auth().currentUser?.phoneNumber || auth().currentUser?.email || ''}</Text>
        </View>
      </View>

      <View style={styles.carbonWidget}>
        <Text style={styles.carbonTitle}>🌍 Global Impact</Text>
        <Text style={styles.carbonSub}>You've saved <Text style={{ fontWeight: 'bold', color: '#0f766e' }}>24.5 kg CO₂</Text> this month!</Text>
        <Text style={styles.carbonRank}>🏆 Top 5% in New Delhi</Text>
      </View>

      <View style={styles.menuGroup}>
        <MenuRow icon={<Wallet color="#0f766e" />} title="Wallet & Multi-Currency" subtitle="₹1,250.00 available" onPress={() => setActiveView('wallet')} />
        <MenuRow icon={<CreditCard color="#0f766e" />} title="Payment Methods" subtitle="Wallet, UPI, Net Banking, Card" onPress={() => setActiveView('payments')} />
      </View>

      <View style={styles.menuGroup}>
        <MenuRow icon={<Settings color="#64748b" />} title="Settings" subtitle="Notifications, Privacy" onPress={() => setActiveView('settings')} />
        <MenuRow icon={<HelpCircle color="#0f766e" />} title="Help & Support" subtitle="FAQs, Contact Us" onPress={() => setActiveView('help')} />
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <LogOut color="#ef4444" size={18} />
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 },
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

  sectionHint: { fontSize: 13, color: '#64748b', marginBottom: 12, fontWeight: '600' },
  methodRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', padding: 16, borderRadius: 14, marginBottom: 12, borderWidth: 2, borderColor: '#e2e8f0', gap: 14 },
  methodRowActive: { borderColor: '#10b981' },
  methodIcon: { fontSize: 26 },
  methodTitle: { fontSize: 15, fontWeight: 'bold', color: '#0f172a' },
  methodSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: '#10b981' },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#10b981' },
  addMethodBtn: { padding: 16, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: '#cbd5e1', alignItems: 'center', marginTop: 4 },
  addMethodText: { color: '#10b981', fontWeight: 'bold', fontSize: 14 },

  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'white', padding: 16, borderRadius: 14, marginBottom: 12 },
  settingTitle: { fontSize: 15, fontWeight: 'bold', color: '#0f172a' },
  settingSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  dangerRow: { backgroundColor: '#fee2e2', padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 12 },
  dangerText: { color: '#ef4444', fontWeight: 'bold', fontSize: 15 },

  helpActions: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  helpAction: { flex: 1, backgroundColor: 'white', paddingVertical: 18, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  helpActionIcon: { fontSize: 24, marginBottom: 6 },
  helpActionText: { fontSize: 14, fontWeight: 'bold', color: '#0f172a' },
  faqRow: { backgroundColor: 'white', padding: 16, borderRadius: 14, marginBottom: 10 },
  faqQRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  faqQ: { fontSize: 14, fontWeight: 'bold', color: '#0f172a', flex: 1, paddingRight: 12 },
  faqChevron: { fontSize: 20, color: '#10b981', fontWeight: 'bold' },
  faqA: { fontSize: 13, color: '#64748b', marginTop: 10, lineHeight: 19 },

  logoutBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginHorizontal: 20, padding: 16, borderRadius: 12, backgroundColor: '#fee2e2', marginTop: 20, marginBottom: 40 },
  logoutText: { color: '#ef4444', fontWeight: 'bold', fontSize: 16 },

  carbonWidget: { backgroundColor: '#f0fdf4', margin: 20, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#bbf7d0', marginTop: 0 },
  carbonTitle: { fontWeight: 'bold', color: '#166534', fontSize: 16, marginBottom: 8 },
  carbonSub: { color: '#15803d', fontSize: 14, marginBottom: 12 },
  carbonRank: { backgroundColor: 'white', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, fontSize: 12, fontWeight: 'bold', color: '#0f766e', overflow: 'hidden' },

  currencyToggle: { flexDirection: 'row', backgroundColor: '#f1f5f9', padding: 4, borderRadius: 12, marginBottom: 20 },
  currencyBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
});
