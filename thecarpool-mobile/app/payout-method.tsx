import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, StatusBar, Alert,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from './services/api';
import * as haptics from './services/haptics';
import { c, font, radius, space } from '../theme/tokens';
import HapticPressable from './components/HapticPressable';
import { formatMoney } from './services/currency';

/**
 * Where a driver's earnings are sent.
 *
 * With details on file, a completed ride pays out to their account about two
 * hours later. Without, earnings sit in the wallet — which is what every driver
 * got until now, because the endpoint existed but nothing in the app called it.
 */
export default function PayoutMethodScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [type, setType] = useState<'VPA' | 'BANK_ACCOUNT'>('VPA');
  const [vpa, setVpa] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccount, setConfirmAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [holderName, setHolderName] = useState('');
  // The only identity field the app asks for. It is what lets earnings be
  // routed to a bank at all — without it, fares stay in the wallet.
  const [pan, setPan] = useState('');
  const [panOnFile, setPanOnFile] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<'MISSING' | 'COLLECTED' | 'LINKED'>('MISSING');
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<{
    configured: boolean; destination: string;
    /** Whether the server can send payouts at all (RazorpayX configured). */
    payouts_available?: boolean;
    /** Where a NEW ride's fare lands — distinct from withdrawing the wallet. */
    earnings_via?: 'BANK' | 'WALLET';
  } | null>(null);
  const [balance, setBalance] = useState(0);
  const [withdrawing, setWithdrawing] = useState(false);

  const refresh = React.useCallback(() => {
    apiFetch('/api/payments/payout-method')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setCurrent(d); })
      .catch(() => { /* first-time setup */ });

    apiFetch('/api/payments/kyc/pan')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setPanOnFile(d.pan ?? null);
        setKycStatus(d.kyc_status ?? 'MISSING');
      })
      .catch(() => { /* first-time setup */ });

    apiFetch('/api/users/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => (me?.id ? apiFetch(`/api/payments/wallet/${me.id}`) : null))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((w) => { if (w) setBalance(Number(w.available_wallet_balance || 0)); })
      .catch(() => { /* balance is a nicety, not a blocker */ });
  }, []);

  useEffect(refresh, [refresh]);

  // Move the wallet balance to the saved destination. Ride earnings are held
  // for 24 hours after the trip; the server enforces that and says so.
  const withdraw = () => {
    Alert.alert(
      'Withdraw ' + formatMoney(balance, { decimals: 2 }),
      `This sends your full wallet balance to ${current?.destination}.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Withdraw',
          onPress: async () => {
            setWithdrawing(true);
            try {
              const res = await apiFetch('/api/payments/payout/release', {
                method: 'POST',
                body: JSON.stringify({ amount: balance }),
              });
              const data = await res.json().catch(() => ({} as any));
              if (!res.ok) {
                haptics.error();
                Alert.alert('Withdrawal not possible', data.message || data.error || 'Please try again later.');
                return;
              }
              haptics.success();
              Alert.alert('On its way', `${formatMoney(balance, { decimals: 2 })} is being sent to ${data.destination || current?.destination}.`);
              refresh();
            } catch {
              haptics.error();
              Alert.alert('Withdrawal failed', 'Network error. Please try again.');
            } finally {
              setWithdrawing(false);
            }
          },
        },
      ]
    );
  };

  // Mirrors the server rules in lib/payouts so the button is honest; the
  // server still validates independently.
  const vpaOk = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,30}$/.test(vpa.trim());
  const accOk = /^\d{6,18}$/.test(accountNumber.replace(/\s/g, ''));
  const accMatches = accountNumber.replace(/\s/g, '') === confirmAccount.replace(/\s/g, '');
  const ifscOk = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase().trim());
  const nameOk = holderName.trim().length >= 2;
  // Mirrors validatePan() on the server: 5 letters, 4 digits, 1 letter, with
  // the 4th character marking an individual. The server revalidates.
  const panValue = pan.replace(/[\s-]/g, '').toUpperCase();
  const panOk = /^[A-Z]{3}[PH][A-Z][0-9]{4}[A-Z]$/.test(panValue);
  // A destination is only useful with an identity attached, so a driver with
  // no PAN on file has to supply one here. Someone already linked has nothing
  // left to prove and can edit their bank details freely.
  const panSatisfied = kycStatus === 'LINKED' || !!panOnFile || panOk;
  const canSave = panSatisfied && (type === 'VPA' ? vpaOk : (accOk && accMatches && ifscOk && nameOk));

  const save = async () => {
    setSaving(true);
    try {
      // PAN first. It is what creates the Razorpay linked account, and saving
      // bank details without it produces a destination nothing can pay into.
      // Skipped once a linked account exists — the server rejects a change.
      if (panOk && kycStatus !== 'LINKED') {
        const panRes = await apiFetch('/api/payments/kyc/pan', {
          method: 'POST',
          body: JSON.stringify({ pan: panValue }),
        });
        const panData = await panRes.json().catch(() => ({} as any));
        if (!panRes.ok) {
          haptics.error();
          Alert.alert('Could not save your PAN', panData.message || panData.error || 'Please check it and try again.');
          setSaving(false);
          return;
        }
        setPanOnFile(panData.pan ?? null);
        setKycStatus(panData.kyc_status ?? 'COLLECTED');
        setPan('');
      }

      const payout_method = type === 'VPA'
        ? { type, vpa: vpa.trim() }
        : {
            type,
            account_number: accountNumber.replace(/\s/g, ''),
            ifsc: ifsc.toUpperCase().trim(),
            name: holderName.trim(),
          };

      const res = await apiFetch('/api/payments/payout-method', {
        method: 'POST',
        body: JSON.stringify({ payout_method }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        haptics.error();
        Alert.alert('Could not save', data.message || data.error || 'Please check the details and try again.');
        return;
      }
      haptics.success();
      Alert.alert(
        'Payout details saved',
        kycStatus === 'LINKED' || panOk
          ? `Earnings will reach ${data.destination} about a day after each ride.`
          : `Saved. Add your PAN to have earnings sent to ${data.destination} — until then they stay in your wallet.`,
        [{ text: 'Done', onPress: () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/wallet')) }]
      );
    } catch {
      haptics.error();
      Alert.alert('Could not save', 'Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" backgroundColor={c.bgApp} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <HapticPressable style={styles.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/wallet'))}>
          <Text style={styles.backText}>← Back</Text>
        </HapticPressable>

        <Text style={styles.h1}>Where should we pay you?</Text>
        <Text style={styles.sub}>
          Add your PAN and account details, and earnings reach your account about a day
          after each ride. Without them, earnings stay in your TheCarPool wallet.
        </Text>

        {current?.configured && (
          <View style={styles.currentBox}>
            <Text style={styles.currentText}>Currently paying to {current.destination}</Text>
            {/* Only offer the button when this deployment can actually send
                money. Previously it was shown regardless, so tapping it
                retried a 503 three times and then failed — with nothing
                explaining that payouts were switched off server-side. */}
            {balance > 0 && current.payouts_available !== false && (
              <HapticPressable
                haptic="press"
                style={[styles.withdrawBtn, withdrawing && styles.disabled]}
                onPress={withdraw}
                disabled={withdrawing}
              >
                {withdrawing
                  ? <ActivityIndicator color={c.goStrong} />
                  : <Text style={styles.withdrawText}>Withdraw {formatMoney(balance, { decimals: 2 })} now</Text>}
              </HapticPressable>
            )}
            {balance > 0 && current.payouts_available === false && (
              <Text style={styles.payoutsOffNote}>
                Withdrawals to UPI and bank aren't switched on yet. Your{' '}
                {formatMoney(balance, { decimals: 2 })} is safe in your wallet and can be
                spent on rides in the meantime.
              </Text>
            )}
          </View>
        )}

        {/* PAN.
            The whole of driver KYC: one number, no uploads, no review queue.
            It exists because a Razorpay linked account — the thing fares are
            actually split to — cannot be created without identifying who is
            receiving the money. */}
        <Text style={styles.label}>PAN number</Text>
        {kycStatus === 'LINKED' ? (
          <View style={styles.panDone}>
            <Text style={styles.panDoneText}>✓ {panOnFile} — payouts to your bank are set up</Text>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder={panOnFile ? `On file: ${panOnFile}` : 'ABCDE1234F'}
              placeholderTextColor={c.textDisabled}
              value={pan}
              onChangeText={(t) => setPan(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={10}
            />
            {pan.length > 0 && !panOk && (
              <Text style={styles.err}>A PAN is 10 characters in the form ABCDE1234F.</Text>
            )}
            <Text style={styles.panNote}>
              {panOnFile
                ? 'Your PAN is saved. We only ever show these few characters back to you.'
                : 'Required to send money to your bank. We never ask for documents or photos.'}
            </Text>
          </>
        )}

        <View style={styles.typeRow}>
          <HapticPressable
            style={[styles.typeBtn, type === 'VPA' && styles.typeBtnOn]}
            onPress={() => setType('VPA')}
          >
            <Text style={[styles.typeText, type === 'VPA' && styles.typeTextOn]}>UPI</Text>
          </HapticPressable>
          <HapticPressable
            style={[styles.typeBtn, type === 'BANK_ACCOUNT' && styles.typeBtnOn]}
            onPress={() => setType('BANK_ACCOUNT')}
          >
            <Text style={[styles.typeText, type === 'BANK_ACCOUNT' && styles.typeTextOn]}>Bank account</Text>
          </HapticPressable>
        </View>

        {type === 'VPA' ? (
          <>
            <Text style={styles.label}>UPI ID</Text>
            <TextInput
              style={styles.input}
              placeholder="yourname@okhdfcbank"
              placeholderTextColor={c.textDisabled}
              value={vpa}
              onChangeText={setVpa}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={72}
            />
            {vpa.length > 0 && !vpaOk && <Text style={styles.err}>That doesn't look like a UPI ID.</Text>}
          </>
        ) : (
          <>
            <Text style={styles.label}>Account holder's name</Text>
            <TextInput
              style={styles.input}
              placeholder="As printed on your passbook"
              placeholderTextColor={c.textDisabled}
              value={holderName}
              onChangeText={setHolderName}
              maxLength={60}
            />

            <Text style={styles.label}>Account number</Text>
            <TextInput
              style={styles.input}
              placeholder="Account number"
              placeholderTextColor={c.textDisabled}
              value={accountNumber}
              onChangeText={(t) => setAccountNumber(t.replace(/[^\d\s]/g, ''))}
              keyboardType="number-pad"
              maxLength={22}
            />

            {/* Typed twice on purpose: a mistyped account number sends money to
                a stranger, and it is not recoverable. */}
            <Text style={styles.label}>Confirm account number</Text>
            <TextInput
              style={styles.input}
              placeholder="Re-enter it"
              placeholderTextColor={c.textDisabled}
              value={confirmAccount}
              onChangeText={(t) => setConfirmAccount(t.replace(/[^\d\s]/g, ''))}
              keyboardType="number-pad"
              maxLength={22}
              contextMenuHidden
            />
            {confirmAccount.length > 0 && !accMatches && (
              <Text style={styles.err}>The two account numbers don't match.</Text>
            )}

            <Text style={styles.label}>IFSC code</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. HDFC0001234"
              placeholderTextColor={c.textDisabled}
              value={ifsc}
              onChangeText={(t) => setIfsc(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={11}
            />
            {ifsc.length > 0 && !ifscOk && <Text style={styles.err}>IFSC is 4 letters, a 0, then 6 characters.</Text>}
          </>
        )}

        <HapticPressable
          haptic="press"
          style={[styles.primaryBtn, (!canSave || saving) && styles.disabled]}
          onPress={save}
          disabled={!canSave || saving}
        >
          {saving
            ? <ActivityIndicator color={c.actionPrimaryText} />
            : <Text style={styles.primaryBtnText}>Save payout details</Text>}
        </HapticPressable>

        <Text style={styles.note}>
          We never show your full account number back to you — only the last 4 digits.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  content: { flexGrow: 1, paddingHorizontal: space.xl },
  back: { paddingVertical: 8, alignSelf: 'flex-start' },
  backText: { fontFamily: font.sansSemibold, fontSize: 15, color: c.textSecondary },
  h1: { fontFamily: font.sansExtrabold, fontSize: 26, color: c.textPrimary, letterSpacing: -0.5, marginTop: space.md },
  sub: { fontFamily: font.sans, fontSize: 14, color: c.textTertiary, marginTop: 6, lineHeight: 20, marginBottom: space.lg },
  currentBox: { backgroundColor: c.goSoft, borderRadius: radius.md, padding: space.md, marginBottom: space.lg },
  currentText: { fontFamily: font.sansMedium, fontSize: 13, color: c.goStrong },
  withdrawBtn: {
    marginTop: space.sm, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.goStrong, backgroundColor: 'transparent',
  },
  withdrawText: { fontFamily: font.sansBold, fontSize: 14, color: c.goStrong },
  payoutsOffNote: { fontFamily: font.sans, fontSize: 12, color: c.textSecondary, lineHeight: 17, marginTop: 8 },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: space.lg },
  typeBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderDefault, alignItems: 'center', backgroundColor: c.surfaceCard },
  typeBtnOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
  typeText: { fontFamily: font.sansSemibold, fontSize: 14, color: c.textSecondary },
  typeTextOn: { color: c.textAccent },
  label: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textPrimary, marginBottom: 6 },
  input: {
    backgroundColor: c.surfaceCard, borderRadius: radius.md, height: 52, paddingHorizontal: 16,
    fontFamily: font.monoBold, fontSize: 16, color: c.textPrimary,
    borderWidth: 1, borderColor: c.borderDefault, marginBottom: space.md,
  },
  err: { fontFamily: font.sans, fontSize: 12, color: c.danger, marginTop: -8, marginBottom: space.md },
  panNote: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginTop: -6, marginBottom: space.lg, lineHeight: 17 },
  panDone: {
    borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 14, marginBottom: space.lg,
    backgroundColor: c.bgApp, borderWidth: 1, borderColor: c.borderSubtle,
  },
  panDoneText: { fontFamily: font.sansSemibold, fontSize: 13, color: c.goStrong },
  primaryBtn: { backgroundColor: c.actionPrimary, height: 54, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: space.sm },
  primaryBtnText: { fontFamily: font.sansBold, fontSize: 15.5, color: c.actionPrimaryText },
  disabled: { opacity: 0.5 },
  note: { fontFamily: font.sans, fontSize: 11.5, color: c.textTertiary, textAlign: 'center', marginTop: space.md, lineHeight: 16 },
});
