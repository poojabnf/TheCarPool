import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, ScrollView, Alert, Linking, ActivityIndicator, Image, TextInput } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CreditCard, Settings, HelpCircle, ChevronRight, LogOut, ShieldCheck, Leaf, Receipt, Camera,
  Landmark, Car, Bell,
} from 'lucide-react-native';
import { auth } from '../services/firebase';
import { apiFetch } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { chooseAndUploadAvatar } from '../services/avatar';
import { useI18n } from '../services/i18n';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';
import Constants from 'expo-constants';
import * as haptics from '../services/haptics';
import HapticPressable from '../components/HapticPressable';
import { formatMoney } from '../services/currency';
import HapticSwitch from '../components/HapticSwitch';

const SUPPORT_EMAIL = 'support@thecarpool.in';
const SUPPORT_PHONE = '+919999002281';
const PRIVACY_URL = 'https://thecarpool.in/privacy';

const FAQS = [
  { q: 'How is the fare split calculated?', a: 'The trip cost is shared equally among co-passengers, with group discounts applied automatically for multiple seats.' },
  { q: 'How does the SOS button work?', a: 'One tap alerts your emergency contacts with your live location during an active trip.' },
  { q: 'How do payouts reach drivers?', a: 'Fares are held in escrow while the ride runs. Once it completes and the dispute window closes, the fare is released and reaches the driver’s account about a day later. Drivers add a PAN and their bank or UPI details to receive it — without them, earnings stay in the wallet.' },
];

// Read the real shipped version rather than a hardcoded string - the old
// literal said 1.2.6 long after the app had moved on, which made every bug
// report point at the wrong build.
const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';

function initials(name?: string | null) {
  if (!name) return 'You';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

export default function AccountInterface() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userProfile, setUserProfile } = useAuthStore();
  const [view, setView] = useState<'menu' | 'settings' | 'help' | 'history' | 'offered' | 'profile'>('menu');
  const [notifications, setNotifications] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [payoutDestination, setPayoutDestination] = useState<string | null>(null);
  const [offered, setOffered] = useState<any[]>([]);
  const [offeredLoading, setOfferedLoading] = useState(false);
  // Name is stored as one `name` field server-side; split for editing only.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const { t, lang, setLang } = useI18n();

  // Commute streaks (roadmap Phase 2 — community wedge).
  const [streaks, setStreaks] = useState<any | null>(null);
  // Gender powers women-only rides — surfaced in Settings so the flagship
  // safety feature is actually reachable.
  const [gender, setGender] = useState<string | null>(null);
  useEffect(() => {
    const uid = auth().currentUser?.uid;
    if (!uid) return;
    apiFetch(`/api/sustainability/streaks/${uid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStreaks)
      .catch(() => {});
    apiFetch('/api/payments/payout-method')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPayoutDestination(d?.configured ? d.destination : null))
      .catch(() => {});
    apiFetch('/api/users/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setGender(d?.gender ?? null))
      .catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => {
    const user = auth().currentUser;
    if (!user) return;
    apiFetch('/api/users/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const resolvedName = d.name || d.displayName || user.displayName || undefined;
        const fields: Record<string, any> = {
          name: resolvedName,
          displayName: resolvedName,
          email: d.email || user.email || undefined,
          address: d.address,
          company: d.company,
          role: d.role,
          photoUrl: d.photo_url || d.photoUrl || user.photoURL || undefined,
        };
        for (const k of Object.keys(fields)) {
          if (fields[k] === undefined || fields[k] === null || fields[k] === '') delete fields[k];
        }
        if (Object.keys(fields).length > 0) setUserProfile(fields);
      })
      .catch(() => { /* keep whatever is already on screen */ });
  }, [setUserProfile]));

  const updateGender = async (g: 'FEMALE' | 'MALE' | 'OTHER') => {
    setGender(g);
    try {
      await apiFetch('/api/users/profile', { method: 'POST', body: JSON.stringify({ gender: g }) });
      if (g === 'FEMALE') Alert.alert('Women-only rides unlocked', 'You can now use women-safety mode when searching, and offer women-only rides as a driver.');
    } catch { /* best-effort; re-fetched next visit */ }
  };

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

  useEffect(() => {
    if (view !== 'offered') return;
    setOfferedLoading(true);
    apiFetch('/api/rides/mine')
      .then((r) => (r.ok ? r.json() : { rides: [] }))
      .then((d) => setOffered(Array.isArray(d) ? d : (d.rides || [])))
      .catch(() => {})
      .finally(() => setOfferedLoading(false));
  }, [view]);

  // Seed the edit fields from the stored profile each time the form opens, so
  // reopening after a cancel shows what is actually saved rather than the
  // abandoned edit.
  useEffect(() => {
    if (view !== 'profile') return;
    const parts = (userProfile?.name || auth().currentUser?.displayName || '').trim().split(/\s+/).filter(Boolean);
    setFirstName(parts[0] || '');
    setLastName(parts.slice(1).join(' '));
    setAddressInput(userProfile?.address || '');
  }, [view, userProfile?.name, userProfile?.address]);

  const saveProfile = async () => {
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first) {
      Alert.alert('Add your first name', 'Co-travellers see this when you book or offer a ride.');
      return;
    }
    setSavingProfile(true);
    const fullName = [first, last].filter(Boolean).join(' ');
    const address = addressInput.trim();
    try {
      const res = await apiFetch('/api/users/profile', {
        method: 'POST',
        body: JSON.stringify({ name: fullName, displayName: fullName, address }),
      }, { timeoutMs: 25000 });
      if (!res.ok) {
        const e = await res.json().catch(() => ({} as any));
        Alert.alert('Could not save', e.error || 'Please try again.');
        return;
      }
      setUserProfile({ name: fullName, address });
      const user = auth().currentUser;
      if (user) {
        user.updateProfile({ displayName: fullName }).catch(() => {});
      }
      setView('menu');
    } catch {
      Alert.alert('Could not save', 'Check your connection and try again.');
    } finally {
      setSavingProfile(false);
    }
  };

  const user = auth().currentUser;
  const name = userProfile?.name || user?.displayName || 'TheCarPool User';
  const contact = user?.phoneNumber || user?.email || userProfile?.email || '';

  const logout = () => Alert.alert('Log out', 'Are you sure you want to log out?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Log out', style: 'destructive', onPress: () => auth().signOut().catch(() => Alert.alert('Error', 'Could not log out.')) },
  ]);

  const [deleting, setDeleting] = useState(false);

  // Two-step by design: this is irreversible, and the first screen tells the
  // user exactly what goes and what is kept before they can reach the button
  // that does it.
  const performDelete = async (forfeitBalance = false) => {
    setDeleting(true);
    try {
      // user_id is redundant on the current backend (the token decides), but the
      // previously deployed version destructures it from the body and throws a
      // 500 when it is absent. Sending it keeps this working on both.
      const res = await apiFetch('/api/safety/account', {
        method: 'DELETE',
        body: JSON.stringify({ user_id: user?.uid, forfeit_balance: forfeitBalance }),
      });
      const data = await res.json().catch(() => ({} as any));

      if (res.status === 409 && Array.isArray(data.blockers)) {
        // A genuine obligation to someone else — held escrow, or passengers
        // booked on an upcoming ride. Not something to override.
        haptics.warning();
        Alert.alert(
          'Sort these out first',
          `${data.blockers.join('\n\n')}\n\nYour account has not been deleted.`
        );
        return;
      }
      if (!res.ok) {
        haptics.error();
        Alert.alert('Could not delete account', data.message || data.error || 'Please try again.');
        return;
      }

      haptics.success();
      const settled = data.balance_settled;
      Alert.alert(
        'Account deleted',
        'Your profile and documents have been removed.'
        + (settled?.outcome === 'REFUND_QUEUED'
          ? `\n\nYour remaining ${formatMoney(Number(settled.amount), { decimals: 2 })} is on its way to your registered account.`
          : '')
        + '\n\nThank you for riding with us.'
      );
      await auth().signOut();
    } catch {
      haptics.error();
      Alert.alert('Could not delete account', 'Network error. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const deleteAccount = () => {
    haptics.warning();
    Alert.alert(
      'Delete your account?',
      'This removes your profile, photo, ID documents and saved places, and cannot be undone.\n\n'
      + 'Completed trips are kept for tax and dispute records, but your name is removed from them.\n\n'
      + 'Any wallet balance is returned to your registered account. If you have not added one, it cannot be paid out.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => Alert.alert(
            'Last chance',
            'This is permanent. Delete your account?',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete permanently', style: 'destructive', onPress: () => performDelete() },
            ]
          ),
        },
      ]
    );
  };

  const toggleNotifications = async (v: boolean) => {
    setNotifications(v);
    try { await apiFetch('/api/users/profile', { method: 'POST', body: JSON.stringify({ notifications_enabled: v }) }); } catch { /* best-effort */ }
  };

  // ── Sub-views ──────────────────────────────────────────────
  if (view !== 'menu') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.subHeader}>
          <HapticPressable onPress={() => setView('menu')}><Text style={styles.back}>← Back</Text></HapticPressable>
          <Text style={styles.subTitle}>{
            view === 'help' ? 'Help & Support'
              : view === 'history' ? 'Booking history'
              : view === 'offered' ? 'Rides you offered'
              : view === 'profile' ? 'Edit profile'
              : 'Settings'
          }</Text>
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
                <HapticSwitch value={notifications} onValueChange={toggleNotifications} trackColor={{ true: c.go, false: c.borderStrong }} thumbColor="#fff" />
              </View>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Gender</Text>
                  <Text style={styles.rowSub}>Female unlocks women-only rides</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(['FEMALE', 'MALE', 'OTHER'] as const).map((g) => (
                    <HapticPressable
                      key={g}
                      style={[styles.langChip, gender === g && styles.langChipOn]}
                      onPress={() => updateGender(g)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.langChipText, gender === g && { color: '#fff' }]}>
                        {g === 'FEMALE' ? '♀' : g === 'MALE' ? '♂' : '⚧'}
                      </Text>
                    </HapticPressable>
                  ))}
                </View>
              </View>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{t('language')}</Text>
                  <Text style={styles.rowSub}>English / हिंदी</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['en', 'hi'] as const).map((l) => (
                    <HapticPressable
                      key={l}
                      style={[styles.langChip, lang === l && styles.langChipOn]}
                      onPress={() => setLang(l)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.langChipText, lang === l && { color: '#fff' }]}>
                        {l === 'en' ? 'EN' : 'हिं'}
                      </Text>
                    </HapticPressable>
                  ))}
                </View>
              </View>
              <HapticPressable style={styles.row} onPress={() => Linking.openURL(PRIVACY_URL)}>
                <View style={{ flex: 1 }}><Text style={styles.rowTitle}>Privacy policy</Text><Text style={styles.rowSub}>How we handle your data</Text></View>
                <ChevronRight color={c.textDisabled} size={18} />
              </HapticPressable>
              <HapticPressable style={styles.row} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
                <View style={{ flex: 1 }}><Text style={styles.rowTitle}>Contact support</Text><Text style={styles.rowSub}>{SUPPORT_EMAIL}</Text></View>
                <ChevronRight color={c.textDisabled} size={18} />
              </HapticPressable>
              <View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.rowTitle}>App version</Text><Text style={styles.rowSub}>TheCarPool v{APP_VERSION}</Text></View></View>
              <HapticPressable
                haptic="warning"
                style={[styles.dangerRow, deleting && { opacity: 0.6 }]}
                onPress={deleteAccount}
                disabled={deleting}
              >
                {deleting
                  ? <ActivityIndicator color={c.danger} />
                  : <Text style={styles.dangerText}>Delete my account</Text>}
              </HapticPressable>
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
                  <Text style={styles.histAmount}>{formatMoney(Math.abs(t.amount || 0), { decimals: 2 })}</Text>
                </View>
              ))}
            </>
          )}

          {view === 'offered' && (
            <>
              {offeredLoading && <ActivityIndicator color={c.accent} style={{ marginTop: 20 }} />}
              {!offeredLoading && offered.length === 0 && (
                <Text style={styles.rowSub}>You haven't offered any rides yet. Post one from the Drive tab.</Text>
              )}
              {offered.map((r, i) => (
                <HapticPressable
                  key={r.id || i}
                  style={styles.histRow}
                  onPress={() => router.push('/(tabs)/driver')}
                  activeOpacity={0.7}
                >
                  <View style={styles.histIcon}><Car color={c.textSecondary} size={16} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {r.source || 'Pickup'} → {r.destination || 'Destination'}
                    </Text>
                    <Text style={styles.rowSub}>
                      {r.departure_time ? new Date(r.departure_time).toLocaleString() : ''}
                      {r.status ? ` · ${r.status}` : ''}
                      {typeof r.seats_available === 'number' && typeof r.seats_total === 'number'
                        ? ` · ${r.seats_total - r.seats_available}/${r.seats_total} booked`
                        : ''}
                    </Text>
                  </View>
                  <Text style={styles.histAmount}>
                    {formatMoney(Number(r.price_split || 0), { decimals: 0 })}
                  </Text>
                </HapticPressable>
              ))}
            </>
          )}

          {view === 'profile' && (
            <>
              <Text style={styles.fieldLabel}>First name *</Text>
              <TextInput
                style={styles.fieldInput}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="e.g. Pooja"
                placeholderTextColor={c.textDisabled}
                autoCapitalize="words"
              />

              <Text style={styles.fieldLabel}>Last name</Text>
              <TextInput
                style={styles.fieldInput}
                value={lastName}
                onChangeText={setLastName}
                placeholder="e.g. Yadav"
                placeholderTextColor={c.textDisabled}
                autoCapitalize="words"
              />

              <Text style={styles.fieldLabel}>Address (optional)</Text>
              <TextInput
                style={styles.fieldInput}
                value={addressInput}
                onChangeText={setAddressInput}
                placeholder="Helps match you with people on your route"
                placeholderTextColor={c.textDisabled}
              />

              <HapticPressable
                haptic="press"
                style={[styles.saveProfileBtn, savingProfile && { opacity: 0.6 }]}
                onPress={saveProfile}
                disabled={savingProfile}
                activeOpacity={0.9}
              >
                {savingProfile
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveProfileText}>Save</Text>}
              </HapticPressable>
            </>
          )}

          {view === 'help' && (
            <>
              <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.lg }}>
                <HapticPressable style={styles.helpBtn} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}><Text style={styles.helpBtnText}>✉  Email us</Text></HapticPressable>
                <HapticPressable style={styles.helpBtn} onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}><Text style={styles.helpBtnText}>☎  Call support</Text></HapticPressable>
              </View>
              {FAQS.map((f, i) => (
                <HapticPressable key={i} style={styles.faq} onPress={() => setOpenFaq(openFaq === i ? null : i)}>
                  <View style={styles.faqQRow}>
                    <Text style={styles.faqQ}>{f.q}</Text>
                    <Text style={styles.faqChev}>{openFaq === i ? '−' : '+'}</Text>
                  </View>
                  {openFaq === i && <Text style={styles.faqA}>{f.a}</Text>}
                </HapticPressable>
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
        <HapticPressable
          style={styles.avatar}
          activeOpacity={0.85}
          onPress={() => chooseAndUploadAvatar((url) => setUserProfile({ photoUrl: url }))}
        >
          {userProfile?.photoUrl
            ? <Image source={{ uri: userProfile.photoUrl }} style={styles.avatarImg} />
            : <Text style={styles.avatarText}>{initials(name)}</Text>}
          <View style={styles.cameraBadge}><Camera color="#fff" size={11} strokeWidth={2.4} /></View>
        </HapticPressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{name}</Text>
          {!!contact && <Text style={styles.contact}>{contact}</Text>}
          {/* Signing up no longer asks for a name, so this is where one gets
              set. Phrased as "Add your name" until there is one, since
              co-travellers otherwise see a generic placeholder. */}
          <HapticPressable onPress={() => setView('profile')} activeOpacity={0.7}>
            <Text style={styles.editProfileLink}>
              {userProfile?.name ? 'Edit profile' : 'Add your name'}
            </Text>
          </HapticPressable>
        </View>
      </View>

      {/* Streaks */}
      {streaks && streaks.total_completed_rides > 0 && (
        <View style={styles.streakRow}>
          <View style={styles.streakCell}>
            <Text style={styles.streakValue}>🔥 {streaks.current_streak_days}</Text>
            <Text style={styles.streakLabel}>day streak</Text>
          </View>
          <View style={styles.streakCell}>
            <Text style={styles.streakValue}>{streaks.total_completed_rides}</Text>
            <Text style={styles.streakLabel}>rides shared</Text>
          </View>
          <View style={styles.streakCell}>
            <Text style={styles.streakValue}>{streaks.points}</Text>
            <Text style={styles.streakLabel}>green points</Text>
          </View>
        </View>
      )}

      {/* Impact */}
      <View style={styles.impact}>
        <View style={styles.impactIcon}><Leaf color={c.goStrong} size={18} strokeWidth={2.2} /></View>
        <Text style={styles.impactText}>You've saved <Text style={styles.impactValue}>24.5 kg</Text> CO₂ this month — top 5% in your city.</Text>
      </View>

      <View style={styles.group}>
        <MenuRow icon={<Bell color={c.textSecondary} size={20} />} title="Notification Center" sub="View all updates, OTPs & alerts" onPress={() => router.push('/notifications')} />
        <MenuRow icon={<CreditCard color={c.textSecondary} size={20} />} title={t('wallet_and_payments')} sub={t('wallet_and_payments_sub')} onPress={() => router.push('/(tabs)/wallet')} />
        {/* Withdrawals were only reachable from inside the Wallet, which made
            them hard to find for anyone looking under their account. The
            subtitle doubles as status so it's obvious whether anything is on
            file without opening the screen. */}
        <MenuRow
          icon={<Landmark color={c.textSecondary} size={20} />}
          title={t('payout_details')}
          sub={payoutDestination ? `Withdrawals go to ${payoutDestination}` : 'Add a UPI ID or bank account to withdraw'}
          onPress={() => router.push('/payout-method')}
        />
        <MenuRow icon={<Receipt color={c.textSecondary} size={20} />} title={t('booking_history')} sub={t('booking_history_sub')} onPress={() => setView('history')} />
        {/* Rides the user OFFERED, as opposed to booked. Previously only
            visible on the Driver tab, so someone looking for "my rides" under
            their account found only the ones they had taken. */}
        <MenuRow icon={<Car color={c.textSecondary} size={20} />} title={t('rides_offered')} sub={t('rides_offered_sub')} onPress={() => setView('offered')} />
        <MenuRow icon={<Leaf color={c.textSecondary} size={20} />} title={t('green_leaderboard')} sub={t('green_leaderboard_sub')} onPress={() => router.push('/leaderboard')} last />
      </View>
      <View style={styles.group}>
        <MenuRow icon={<ShieldCheck color={c.textSecondary} size={20} />} title={t('safety_centre')} sub={t('safety_centre_sub')} onPress={() => router.push('/safety-center')} />
        <MenuRow icon={<Settings color={c.textSecondary} size={20} />} title={t('settings')} sub={t('settings_sub')} onPress={() => setView('settings')} />
        <MenuRow icon={<HelpCircle color={c.textSecondary} size={20} />} title={t('help_support')} sub={t('help_support_sub')} onPress={() => setView('help')} last />
      </View>

      <HapticPressable style={styles.logout} onPress={logout}>
        <LogOut color={c.danger} size={18} />
        <Text style={styles.logoutText}>{t('log_out')}</Text>
      </HapticPressable>
    </ScrollView>
  );
}

function MenuRow({ icon, title, sub, onPress, last }: any) {
  return (
    <HapticPressable style={[styles.menuRow, !last && styles.menuRowBorder]} onPress={onPress}>
      <View style={styles.iconBox}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSub}>{sub}</Text>
      </View>
      <ChevronRight color={c.textDisabled} size={18} />
    </HapticPressable>
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
  editProfileLink: { fontFamily: font.sansSemibold, fontSize: 12, color: c.textAccent, marginTop: 4 },
  fieldLabel: { fontFamily: font.sansSemibold, fontSize: 12, color: c.textSecondary, marginTop: 16, marginBottom: 6 },
  fieldInput: {
    backgroundColor: c.surfaceSunken, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: font.sans, fontSize: 15, color: c.textPrimary, borderWidth: 1, borderColor: c.borderSubtle,
  },
  saveProfileBtn: {
    backgroundColor: c.go, borderRadius: radius.md, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', marginTop: 24,
  },
  saveProfileText: { fontFamily: font.sansSemibold, fontSize: 15, color: '#fff' },
  streakRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  streakCell: { flex: 1, backgroundColor: c.surfaceCard, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderSubtle, alignItems: 'center', paddingVertical: space.md },
  streakValue: { fontFamily: font.monoBold, fontSize: 17, color: c.textPrimary },
  streakLabel: { fontFamily: font.sans, fontSize: 11, color: c.textTertiary, marginTop: 2 },
  langChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surfaceCard },
  langChipOn: { backgroundColor: c.textPrimary, borderColor: c.textPrimary },
  langChipText: { fontFamily: font.sansBold, fontSize: 13, color: c.textSecondary },
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
