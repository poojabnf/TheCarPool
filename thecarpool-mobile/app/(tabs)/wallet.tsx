import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';
import { apiFetch } from '../services/api';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';

interface Txn { id: string; type: string; label: string; amount: number; status: string; at: string | null; }

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const uid = auth().currentUser?.uid ?? null;
  const [balance, setBalance] = useState<number | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.lg, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={c.textTertiary} />}
    >
      <Text style={styles.h1}>Wallet</Text>

      {/* Balance card */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>TheCarPool balance</Text>
        {loading
          ? <ActivityIndicator color={c.accent} style={{ alignSelf: 'flex-start', marginVertical: 8 }} />
          : <Text style={styles.balanceValue}>₹{(balance ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>}
        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary]} activeOpacity={0.85}>
            <ArrowDownLeft color={c.actionPrimaryText} size={16} strokeWidth={2.4} />
            <Text style={styles.actionPrimaryText}>Add money</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.actionSecondary]} activeOpacity={0.85}>
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
});
