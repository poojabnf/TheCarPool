import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, Modal, TextInput, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import { ArrowDownLeft, ArrowUpRight, Smartphone, Landmark, CreditCard, Wallet as WalletIcon, X, Check } from 'lucide-react-native';
import { apiFetch } from '../services/api';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';

interface Txn { id: string; type: string; label: string; amount: number; status: string; at: string | null; }

const PAY_METHODS = [
  { key: 'upi', title: 'UPI', sub: 'GPay, PhonePe, Paytm & more', Icon: Smartphone },
  { key: 'netbanking', title: 'Net Banking', sub: 'All major banks', Icon: Landmark },
  { key: 'card', title: 'Credit / Debit Card', sub: 'Visa, Mastercard, RuPay, Amex', Icon: CreditCard },
  { key: 'wallet', title: 'Wallet', sub: 'Amazon Pay, Mobikwik & more', Icon: WalletIcon },
] as const;
const QUICK_AMOUNTS = [200, 500, 1000, 2000];

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const uid = auth().currentUser?.uid ?? null;
  const [balance, setBalance] = useState<number | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('upi');
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    if (!uid) { setLoading(false); return; }
    try {
      const [w, h] = await Promise.all([
        apiFetch(`/api/payments/wallet/${uid}`),
        apiFetch(`/api/payments/history/${uid}`),
      ]);
      if (w.ok) setBalance((await w.json()).available_wallet_balance ?? 0);
      if (h.ok) setTxns((await h.json()).transactions ?? []);
    } catch { /* keep last state */ }
    finally { setLoading(false); }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const proceedAdd = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert('Enter an amount', 'Please enter how much you want to add.'); return; }
    setPaying(true);
    try {
      // Create a Razorpay order on the backend (once Razorpay keys are set).
      const res = await apiFetch('/api/payments/order', {
        method: 'POST',
        body: JSON.stringify({ amount: amt, currency: 'INR' }),
      });
      // In-app native checkout needs the Razorpay SDK (added in a native build);
      // for now route to the secure Razorpay hosted page to complete payment.
      const url = `https://rzp.io/l/thecarpool-topup`;
      Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open the payment page.'));
      setShowAdd(false);
      setAmount('');
      if (res.status === 503) {
        // expected until Razorpay keys are configured server-side
      }
    } catch {
      Alert.alert('Payment failed', 'Network error. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.lg, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }} tintColor={c.textTertiary} />}
    >
      <Text style={styles.h1}>Wallet</Text>

      {/* Balance card */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>TheCarPool balance</Text>
        {loading
          ? <ActivityIndicator color={c.accent} style={{ alignSelf: 'flex-start', marginVertical: 8 }} />
          : <Text style={styles.balanceValue}>₹{(balance ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>}
        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary]} activeOpacity={0.85} onPress={() => setShowAdd(true)}>
            <ArrowDownLeft color={c.actionPrimaryText} size={16} strokeWidth={2.4} />
            <Text style={styles.actionPrimaryText}>Add money</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionSecondary]}
            activeOpacity={0.85}
            onPress={() => Alert.alert(
              'Withdraw',
              'Funds are released to your UPI after escrow settles (when your ride completes). Contact support@thecarpool.in to request an early withdrawal.',
              [{ text: 'OK' }]
            )}
          >
            <ArrowUpRight color={c.textPrimary} size={16} strokeWidth={2.4} />
            <Text style={styles.actionSecondaryText}>Withdraw</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Recent activity</Text>
      {txns.length === 0 && !loading && (
        <Text style={styles.empty}>No transactions yet.</Text>
      )}
      {txns.map((t) => {
        const credit = t.amount >= 0;
        return (
          <View key={t.id} style={styles.txnRow}>
            <View style={[styles.txnIcon, { backgroundColor: credit ? c.goSoft : c.dangerSoft }]}>
              {credit
                ? <ArrowDownLeft color={c.goStrong} size={16} strokeWidth={2.4} />
                : <ArrowUpRight color={c.dangerStrong} size={16} strokeWidth={2.4} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.txnLabel}>{t.label}</Text>
              <Text style={styles.txnMeta}>{t.at ? new Date(t.at).toLocaleDateString() : t.status}</Text>
            </View>
            <Text style={[styles.txnAmount, { color: credit ? c.goStrong : c.dangerStrong }]}>
              {credit ? '+' : '−'}₹{Math.abs(t.amount).toFixed(2)}
            </Text>
          </View>
        );
      })}

      <Modal visible={showAdd} animationType="slide" transparent onRequestClose={() => setShowAdd(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Add money</Text>
              <TouchableOpacity onPress={() => setShowAdd(false)}><X color={c.textTertiary} size={22} /></TouchableOpacity>
            </View>

            <Text style={styles.label}>Amount</Text>
            <View style={styles.amountRow}>
              <Text style={styles.rupee}>₹</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={c.textDisabled}
              />
            </View>
            <View style={styles.quickRow}>
              {QUICK_AMOUNTS.map((q) => (
                <TouchableOpacity key={q} style={styles.quickChip} onPress={() => setAmount(String(q))}>
                  <Text style={styles.quickText}>₹{q}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { marginTop: space.lg }]}>Pay using</Text>
            {PAY_METHODS.map((m) => {
              const on = method === m.key;
              return (
                <TouchableOpacity key={m.key} style={[styles.methodRow, on && styles.methodRowOn]} onPress={() => setMethod(m.key)} activeOpacity={0.85}>
                  <View style={styles.methodIcon}><m.Icon color={c.textSecondary} size={18} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodTitle}>{m.title}</Text>
                    <Text style={styles.methodSub}>{m.sub}</Text>
                  </View>
                  <View style={[styles.radio, on && styles.radioOn]}>{on && <Check color="#fff" size={12} strokeWidth={3} />}</View>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity style={[styles.proceed, (!amount || paying) && styles.proceedDisabled]} onPress={proceedAdd} disabled={!amount || paying} activeOpacity={0.9}>
              {paying ? <ActivityIndicator color="#fff" /> : <Text style={styles.proceedText}>Add {amount ? `₹${amount}` : 'money'}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  h1: { fontFamily: font.sansExtrabold, fontSize: 28, color: c.textPrimary, letterSpacing: -0.5, marginBottom: space.lg },
  balanceCard: {
    backgroundColor: c.textPrimary, borderRadius: radius.xl, padding: space.xl, marginBottom: space.xl, ...shadowSm,
  },
  balanceLabel: { fontFamily: font.sansMedium, fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  balanceValue: { fontFamily: font.monoBold, fontSize: 36, color: '#fff', marginTop: 6, marginBottom: space.lg, letterSpacing: -1 },
  actionRow: { flexDirection: 'row', gap: space.sm },
  actionBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: radius.md },
  actionPrimary: { backgroundColor: '#fff' },
  actionPrimaryText: { fontFamily: font.sansBold, fontSize: 14, color: c.textPrimary },
  actionSecondary: { backgroundColor: 'rgba(255,255,255,0.12)' },
  actionSecondaryText: { fontFamily: font.sansBold, fontSize: 14, color: '#fff' },
  sectionTitle: { fontFamily: font.sansBold, fontSize: 15, color: c.textPrimary, marginBottom: space.md },
  empty: { fontFamily: font.sans, fontSize: 13, color: c.textTertiary },
  txnRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md,
    borderBottomWidth: 1, borderBottomColor: c.borderSubtle,
  },
  txnIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  txnLabel: { fontFamily: font.sansSemibold, fontSize: 14, color: c.textPrimary },
  txnMeta: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginTop: 1 },
  txnAmount: { fontFamily: font.monoBold, fontSize: 14 },

  modalBg: { flex: 1, backgroundColor: 'rgba(11,15,20,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.bgBase, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, maxHeight: '90%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.lg },
  sheetTitle: { fontFamily: font.sansBold, fontSize: 18, color: c.textPrimary },
  label: { fontFamily: font.sansSemibold, fontSize: 12.5, color: c.textSecondary, marginBottom: 8 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.surfaceSunken, borderRadius: radius.md, paddingHorizontal: 16, height: 56, borderWidth: 1, borderColor: c.borderSubtle },
  rupee: { fontFamily: font.monoBold, fontSize: 24, color: c.textTertiary },
  amountInput: { flex: 1, fontFamily: font.monoBold, fontSize: 24, color: c.textPrimary, padding: 0 },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: space.sm },
  quickChip: { flex: 1, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceCard, borderWidth: 1, borderColor: c.borderSubtle },
  quickText: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textSecondary },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.md, marginBottom: space.sm, borderWidth: 1.5, borderColor: c.borderSubtle },
  methodRowOn: { borderColor: c.go },
  methodIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: c.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  methodTitle: { fontFamily: font.sansSemibold, fontSize: 14.5, color: c.textPrimary },
  methodSub: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginTop: 1 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: c.go, borderColor: c.go },
  proceed: { backgroundColor: c.go, borderRadius: radius.md, height: 54, alignItems: 'center', justifyContent: 'center', marginTop: space.lg },
  proceedDisabled: { opacity: 0.5 },
  proceedText: { fontFamily: font.sansBold, fontSize: 16, color: '#fff' },
});
