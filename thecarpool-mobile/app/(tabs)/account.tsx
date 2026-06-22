import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Switch, Alert, Linking, ActivityIndicator, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CreditCard, Settings, HelpCircle, ChevronRight, LogOut, Newspaper, ShieldCheck, Leaf, Receipt, Camera,
} from 'lucide-react-native';
import { auth } from '../services/firebase';
import { apiFetch } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { chooseAndUploadAvatar } from '../services/avatar';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';

const SUPPORT_EMAIL = 'support@thecarpool.in';
const SUPPORT_PHONE = '+919999002281';
const PRIVACY_URL = 'https://thecarpool.in/privacy';

const FAQS = [
  { q: 'How is the fare split calculated?', a: 'The trip cost is shared equally among co-passengers, with group discounts applied automatically for multiple seats.' },
  { q: 'Why do I need to verify (KYC)?', a: 'Verification keeps the community safe — every driver and rider confirms identity before booking a ride.' },
  { q: 'How does the SOS button work?', a: 'One tap alerts your emergency contacts with your live location during an active trip.' },
  { q: 'How do payouts reach drivers?', a: 'Fares are held in escrow and released to the driver’s UPI once the ride completes.' },
];

function initials(name?: string | null) {
  if (!name) return 'You';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

export default function AccountInterface() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { kycStatus, userProfile, setUserProfile } = useAuthStore();
  const [view, setView] = useState<'menu' | 'settings' | 'help' | 'history'>('menu');
  const [notifications, setNotifications] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (view !== 'history') return;
    const uid = auth().currentUser?.uid;
    if (!uid) return;
    setHistoryLoading(true);
    apiFetch(`/api/payments/history/${uid}`)
      .then((r) => (r.ok ? r.json() : { transactions: [] }))
      .then((d) => setHistory((d.transactions || []).filter((t: any) => t.type === 'DEBIT' || /ride/i.test(t.label || ''))))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [view]);

  const user = auth().currentUser;
  const name = userProfile?.name || user?.displayName || 'TheCarPool User';
  const contact = user?.phoneNumber || user?.email || userProfile?.email || '';

  const kycChip =
    kycStatus === 'verified' ? { label: 'Verified', bg: c.goSoft, fg: c.goStrong }
    : kycStatus === 'pending' ? { label: 'Verification pending', bg: c.warnSoft, fg: c.warn }
    : { label: 'Not verified', bg: c.surfaceInset, fg: c.textTertiary };

  const logout = () => Alert.alert('Log out', 'Are you sure you want to log out?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Log out', style: 'destructive', onPress: () => auth().signOut().catch(() => Alert.alert('Error', 'Could not log out.')) },
  ]);

  const deleteAccount = () => Alert.alert(
    'Delete account', 'This permanently erases your profile, rides, and bookings. This cannot be undone.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await apiFetch('/api/safety/account', { method: 'DELETE', body: JSON.stringify({ user_id: user?.uid }) });
          await auth().signOut();
        } catch { Alert.alert('Error', 'Could not delete account.'); }
      } },
    ]
  );

  const toggleNotifications = async (v: boolean) => {
    setNotifications(v);
    try { await apiFetch('/api/users/profile', { method: 'POST', body: JSON.stringify({ notifications_enabled: v }) }); } catch { /* best-effort */ }
  };

  // ── Sub-views ──────────────────────────────────────────────
  if (view !== 'menu') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.subHeader}>
          <TouchableOpacity onPress={() => setView('menu')}><Text style={styles.back}>← Back</Text></TouchableOpacity>
          <Text style={styles.subTitle}>{view === 'help' ? 'Help & Support' : view === 'history' ? 'Booking history' : 'Settings'}</Text>
          <View style={{ width: 50 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: space.xl }}>
          {view === 'settings' && (
            <>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Push notifications</Text>
                  <Text style={styles.rowSub}>Ride matches, updates & alerts</Text>
                </View>
                <Switch value={notifications} onValueChange={toggleNotifications} trackColor={{ true: c.go, false: c.borderStrong }} thumbColor="#fff" />
              </View>
              <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(PRIVACY_URL)}>
                <View style={{ flex: 1 }}><Text style={styles.rowTitle}>Privacy policy</Text><Text style={styles.rowSub}>How we handle your data</Text></View>
                <ChevronRight color={c.textDisabled} size={18} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
                <View style={{ flex: 1 }}><Text style={styles.rowTitle}>Contact support</Text><Text style={styles.rowSub}>{SUPPORT_EMAIL}</Text></View>
                <ChevronRight color={c.textDisabled} size={18} />
              </TouchableOpacity>
              <View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.rowTitle}>App version</Text><Text style={styles.rowSub}>TheCarPool v1.2.6</Text></View></View>
              <TouchableOpacity style={styles.dangerRow} onPress={deleteAccount}><Text style={styles.dangerText}>Delete my account</Text></TouchableOpacity>
            </>
          )}
          {view === 'history' && (
            <>
              {historyLoading && <ActivityIndicator color={c.accent} style={{ marginTop: 20 }} />}
              {!historyLoading && history.length === 0 && <Text style={styles.rowSub}>No bookings yet. Your past rides and payments will appear here.</Text>}
              {history.map((t, i) => (
                <View key={t.id || i} style={styles.histRow}>
                  <View style={styles.histIcon}><Receipt color={c.textSecondary} size={16} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{t.label || 'Ride payment'}</Text>
                    <Text style={styles.rowSub}>{t.at ? new Date(t.at).toLocaleString() : (t.status || '')}</Text>
                  </View>
                  <Text style={styles.histAmount}>₹{Math.abs(t.amount || 0).toFixed(2)}</Text>
                </View>
              ))}
            </>
          )}
          {view === 'help' && (
            <>
              <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.lg }}>
                <TouchableOpacity style={styles.helpBtn} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}><Text style={styles.helpBtnText}>✉  Email us</Text></TouchableOpacity>
                <TouchableOpacity style={styles.helpBtn} onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}><Text style={styles.helpBtnText}>☎  Call support</Text></TouchableOpacity>
              </View>
              {FAQS.map((f, i) => (
                <TouchableOpacity key={i} style={styles.faq} onPress={() => setOpenFaq(openFaq === i ? null : i)}>
                  <View style={styles.faqQRow}>
                    <Text style={styles.faqQ}>{f.q}</Text>
                    <Text style={styles.faqChev}>{openFaq === i ? '−' : '+'}</Text>
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

  // ── Main "You" ─────────────────────────────────────────────
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.lg, paddingBottom: 40 }}>
      <Text style={styles.h1}>You</Text>

      <View style={styles.profile}>
        <TouchableOpacity
          style={styles.avatar}
          activeOpacity={0.85}
          onPress={() => chooseAndUploadAvatar((url) => setUserProfile({ photoUrl: url }))}
        >
          {userProfile?.photoUrl
            ? <Image source={{ uri: userProfile.photoUrl }} style={styles.avatarImg} />
            : <Text style={styles.avatarText}>{initials(name)}</Text>}
          <View style={styles.cameraBadge}><Camera color="#fff" size={11} strokeWidth={2.4} /></View>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{name}</Text>
          {!!contact && <Text style={styles.contact}>{contact}</Text>}
          <View style={[styles.kycChip, { backgroundColor: kycChip.bg }]}>
            <ShieldCheck color={kycChip.fg} size={12} strokeWidth={2.4} />
            <Text style={[styles.kycChipText, { color: kycChip.fg }]}>{kycChip.label}</Text>
          </View>
        </View>
      </View>

      {kycStatus !== 'verified' && (
        <TouchableOpacity style={styles.verifyCta} onPress={() => router.push('/onboarding')} activeOpacity={0.9}>
          <Text style={styles.verifyCtaText}>Complete verification</Text>
          <ChevronRight color={c.actionPrimaryText} size={18} />
        </TouchableOpacity>
      )}

      {/* Impact */}
      <View style={styles.impact}>
        <View style={styles.impactIcon}><Leaf color={c.goStrong} size={18} strokeWidth={2.2} /></View>
        <Text style={styles.impactText}>You've saved <Text style={styles.impactValue}>24.5 kg</Text> CO₂ this month — top 5% in your city.</Text>
      </View>

      <View style={styles.group}>
        <MenuRow icon={<CreditCard color={c.textSecondary} size={20} />} title="Wallet & payments" sub="Balance, UPI, cards" onPress={() => router.push('/(tabs)/wallet')} />
        <MenuRow icon={<Receipt color={c.textSecondary} size={20} />} title="Booking history" sub="Your past rides & payments" onPress={() => setView('history')} />
        <MenuRow icon={<Newspaper color={c.textSecondary} size={20} />} title="Classifieds" sub="Community marketplace" onPress={() => router.push('/(tabs)/classifieds')} last />
      </View>
      <View style={styles.group}>
        <MenuRow icon={<Settings color={c.textSecondary} size={20} />} title="Settings" sub="Notifications, privacy, account" onPress={() => setView('settings')} />
        <MenuRow icon={<HelpCircle color={c.textSecondary} size={20} />} title="Help & support" sub="FAQs, contact us" onPress={() => setView('help')} last />
      </View>

      <TouchableOpacity style={styles.logout} onPress={logout}>
        <LogOut color={c.danger} size={18} />
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function MenuRow({ icon, title, sub, onPress, last }: any) {
  return (
    <TouchableOpacity style={[styles.menuRow, !last && styles.menuRowBorder]} onPress={onPress}>
      <View style={styles.iconBox}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSub}>{sub}</Text>
      </View>
      <ChevronRight color={c.textDisabled} size={18} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  h1: { fontFamily: font.sansExtrabold, fontSize: 28, color: c.textPrimary, letterSpacing: -0.5, marginBottom: space.lg },

  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg },
  avatar: { width: 60, height: 60, borderRadius: radius.pill, backgroundColor: c.textPrimary, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: 60, height: 60, borderRadius: radius.pill },
  avatarText: { fontFamily: font.sansBold, fontSize: 20, color: '#fff' },
  cameraBadge: { position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: c.go, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.bgApp },
  name: { fontFamily: font.sansBold, fontSize: 19, color: c.textPrimary },
  contact: { fontFamily: font.sans, fontSize: 13, color: c.textTertiary, marginTop: 1 },
  kycChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, marginTop: 8 },
  kycChipText: { fontFamily: font.sansSemibold, fontSize: 11.5 },

  verifyCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.actionPrimary, borderRadius: radius.md, paddingHorizontal: space.lg, height: 50, marginBottom: space.lg },
  verifyCtaText: { fontFamily: font.sansBold, fontSize: 15, color: c.actionPrimaryText },

  impact: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.goSoft, borderRadius: radius.lg, padding: space.lg, marginBottom: space.lg },
  impactIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  impactText: { flex: 1, fontFamily: font.sans, fontSize: 13, color: c.textSecondary, lineHeight: 19 },
  impactValue: { fontFamily: font.monoBold, color: c.goStrong },

  group: { backgroundColor: c.surfaceCard, borderRadius: radius.lg, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: space.md, overflow: 'hidden', ...shadowSm },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  iconBox: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: c.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { fontFamily: font.sansSemibold, fontSize: 15, color: c.textPrimary },
  menuSub: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginTop: 1 },

  logout: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, padding: space.md, borderRadius: radius.md, backgroundColor: c.dangerSoft, marginTop: space.sm },
  logoutText: { fontFamily: font.sansBold, fontSize: 15, color: c.danger },

  subHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, marginBottom: space.sm },
  back: { fontFamily: font.sansSemibold, color: c.textSecondary, fontSize: 15, width: 50 },
  subTitle: { flex: 1, textAlign: 'center', fontFamily: font.sansBold, fontSize: 17, color: c.textPrimary },

  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceCard, padding: space.md, borderRadius: radius.md, marginBottom: space.sm, borderWidth: 1, borderColor: c.borderSubtle },
  rowTitle: { fontFamily: font.sansSemibold, fontSize: 14.5, color: c.textPrimary },
  rowSub: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginTop: 1 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: c.surfaceCard, padding: space.md, borderRadius: radius.md, marginBottom: space.sm, borderWidth: 1, borderColor: c.borderSubtle },
  histIcon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  histAmount: { fontFamily: font.monoBold, fontSize: 14, color: c.textPrimary },
  dangerRow: { backgroundColor: c.dangerSoft, padding: space.md, borderRadius: radius.md, alignItems: 'center', marginTop: space.sm },
  dangerText: { fontFamily: font.sansBold, fontSize: 14.5, color: c.danger },

  helpBtn: { flex: 1, backgroundColor: c.surfaceCard, paddingVertical: 16, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: c.borderSubtle },
  helpBtnText: { fontFamily: font.sansSemibold, fontSize: 14, color: c.textPrimary },
  faq: { backgroundColor: c.surfaceCard, padding: space.md, borderRadius: radius.md, marginBottom: space.sm, borderWidth: 1, borderColor: c.borderSubtle },
  faqQRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  faqQ: { flex: 1, fontFamily: font.sansSemibold, fontSize: 14, color: c.textPrimary, paddingRight: 12 },
  faqChev: { fontFamily: font.sansBold, fontSize: 18, color: c.textAccent },
  faqA: { fontFamily: font.sans, fontSize: 13, color: c.textSecondary, marginTop: 10, lineHeight: 19 },
});
