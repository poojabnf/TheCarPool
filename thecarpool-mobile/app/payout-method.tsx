import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TextInput, StyleSheet, StatusBar, Alert,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Landmark, Smartphone, CheckCircle2, Clock, AlertCircle,
  ChevronDown, ChevronUp, ArrowUpRight, ShieldCheck, History,
  Sparkles, RefreshCw, Check,
} from 'lucide-react-native';
import { apiFetch } from './services/api';
import * as haptics from './services/haptics';
import { c, font, radius, space, shadowSm } from '../theme/tokens';
import HapticPressable from './components/HapticPressable';
import { formatMoney } from './services/currency';

interface PayoutStage {
  id: string;
  label: string;
  description: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CURRENT';
  timestamp: string | null;
}

interface HistoricalPayout {
  id: string;
  amount: number;
  currency: string;
  destination: string;
  status: 'INITIATED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  estimated_arrival: string;
  stages: PayoutStage[];
  created_at: string | null;
  updated_at: string | null;
  transaction_ref?: string;
  razorpayx_payout_id?: string | null;
  failure_reason?: string;
}

interface SavedDetails {
  type: 'VPA' | 'BANK_ACCOUNT';
  vpa?: string;
  name?: string;
  ifsc?: string;
  account_number_masked?: string;
}

export default function PayoutMethodScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [type, setType] = useState<'VPA' | 'BANK_ACCOUNT'>('VPA');
  const [vpa, setVpa] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccount, setConfirmAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [holderName, setHolderName] = useState('');
  const [pan, setPan] = useState('');
  const [panOnFile, setPanOnFile] = useState<string | null>(null);
  // Razorpay needs an email to open a payout account. Most people here sign in
  // with phone OTP and have none on file, which silently blocked the very
  // first real PAN submission — the PAN saved, no account was created, and
  // nothing said so.
  const [payoutEmail, setPayoutEmail] = useState('');
  const [needsEmail, setNeedsEmail] = useState(false);
  const [kycStatus, setKycStatus] = useState<'MISSING' | 'COLLECTED' | 'LINKED'>('MISSING');
  const [saving, setSaving] = useState(false);
  const [isEditingDetails, setIsEditingDetails] = useState(false);

  const [current, setCurrent] = useState<{
    configured: boolean;
    destination: string;
    saved_details?: SavedDetails | null;
    payouts_available?: boolean;
    earnings_via?: 'BANK' | 'WALLET';
  } | null>(null);

  const [balance, setBalance] = useState(0);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  // Active / Recent payout tracking & Historical payouts
  const [activeTracking, setActiveTracking] = useState<HistoricalPayout | null>(null);
  const [history, setHistory] = useState<HistoricalPayout[]>([]);
  const [expandedPayoutId, setExpandedPayoutId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const refresh = useCallback(() => {
    // 1. Fetch saved payout method & pre-fill
    apiFetch('/api/payments/payout-method')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setCurrent(d);
        if (d.saved_details) {
          setType(d.saved_details.type);
          if (d.saved_details.vpa) setVpa(d.saved_details.vpa);
          if (d.saved_details.name) setHolderName(d.saved_details.name);
          if (d.saved_details.ifsc) setIfsc(d.saved_details.ifsc);
        }
        if (d.pan) setPanOnFile(d.pan);
        if (d.kyc_status) setKycStatus(d.kyc_status);
        if (d.configured) setIsEditingDetails(false);
        else setIsEditingDetails(true);
      })
      .catch(() => { setIsEditingDetails(true); });

    // 2. Fetch PAN KYC
    apiFetch('/api/payments/kyc/pan')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        if (d.pan) setPanOnFile(d.pan);
        if (d.kyc_status) setKycStatus(d.kyc_status);
      })
      .catch(() => {});

    // 3. Fetch Wallet balance
    apiFetch('/api/users/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => (me?.id ? apiFetch(`/api/payments/wallet/${me.id}`) : null))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((w) => {
        if (w) {
          const bal = Number(w.available_wallet_balance || 0);
          setBalance(bal);
          setWithdrawAmount(bal > 0 ? String(bal) : '');
        }
      })
      .catch(() => {});

    // 4. Fetch 6-month Payout History
    setLoadingHistory(true);
    apiFetch('/api/payments/payouts/history')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.payouts) {
          setHistory(d.payouts);
          // If there is an in-flight payout, show it in active tracker
          const inFlight = d.payouts.find((p: HistoricalPayout) => p.status === 'INITIATED' || p.status === 'PROCESSING');
          if (inFlight) setActiveTracking(inFlight);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Handle Withdrawal Submission
  const numericAmount = parseFloat(withdrawAmount) || 0;
  const isAmountValid = numericAmount > 0 && numericAmount <= balance;

  const handleWithdraw = () => {
    if (!isAmountValid) {
      Alert.alert('Invalid Amount', `Please enter an amount between ₹1 and ${formatMoney(balance, { decimals: 2 })}.`);
      return;
    }

    Alert.alert(
      `Withdraw ${formatMoney(numericAmount, { decimals: 2 })}`,
      `Funds will be transferred to your saved destination:\n${current?.destination}\n\nEstimated arrival: 15 mins – 2 hours.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm & Transfer',
          onPress: async () => {
            setWithdrawing(true);
            try {
              const res = await apiFetch('/api/payments/payout/release', {
                method: 'POST',
                body: JSON.stringify({ amount: numericAmount }),
              });
              const data = await res.json().catch(() => ({} as any));
              if (!res.ok) {
                haptics.error();
                Alert.alert('Withdrawal not possible', data.message || data.error || 'Please try again later.');
                return;
              }

              haptics.success();
              const newPayout: HistoricalPayout = {
                id: data.transaction_ref || 'PO_' + Date.now(),
                amount: numericAmount,
                currency: 'INR',
                destination: data.destination || current?.destination || 'Saved Account',
                status: 'PROCESSING',
                estimated_arrival: data.estimated_arrival || '15 mins – 2 hours',
                stages: data.stages || [
                  { id: 'INITIATED', label: 'Withdrawal Initiated', description: 'Withdrawal request verified and fund reserved', status: 'COMPLETED', timestamp: new Date().toISOString() },
                  { id: 'PROCESSING', label: 'Bank Processing', description: 'Transmitting over IMPS / UPI banking rails', status: 'CURRENT', timestamp: new Date().toISOString() },
                  { id: 'CREDITED', label: 'Credited to Account', description: 'Funds successfully credited to your account', status: 'PENDING', timestamp: null },
                ],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                transaction_ref: data.transaction_ref,
              };

              setActiveTracking(newPayout);
              Alert.alert('Withdrawal Initiated! ⚡', `${formatMoney(numericAmount, { decimals: 2 })} is on its way to ${data.destination || current?.destination}.`);
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

  // Form Validation
  const vpaOk = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,30}$/.test(vpa.trim());
  const accOk = /^\d{6,18}$/.test(accountNumber.replace(/\s/g, ''));
  const accMatches = accountNumber.replace(/\s/g, '') === confirmAccount.replace(/\s/g, '');
  const ifscOk = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase().trim());
  const nameOk = holderName.trim().length >= 2;
  const panValue = pan.replace(/[\s-]/g, '').toUpperCase();
  const panOk = /^[A-Z]{3}[PH][A-Z][0-9]{4}[A-Z]$/.test(panValue);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(payoutEmail.trim());
  const emailSatisfied = !needsEmail || kycStatus === 'LINKED' || emailOk;
  const panSatisfied = kycStatus === 'LINKED' || !!panOnFile || panOk;
  const canSave = panSatisfied && emailSatisfied && (type === 'VPA' ? vpaOk : (accOk && accMatches && ifscOk && nameOk));

  const saveDetails = async () => {
    setSaving(true);
    try {
      if (panOk && kycStatus !== 'LINKED') {
        const panRes = await apiFetch('/api/payments/kyc/pan', {
          method: 'POST',
          body: JSON.stringify({
            pan: panValue,
            ...(payoutEmail.trim() ? { email: payoutEmail.trim() } : {}),
          }),
        });
        const panData = await panRes.json().catch(() => ({} as any));
        if (!panRes.ok) {
          haptics.error();
          Alert.alert('Could not save PAN', panData.message || panData.error || 'Please check it and try again.');
          setSaving(false);
          return;
        }
        setPanOnFile(panData.pan ?? null);
        setKycStatus(panData.kyc_status ?? 'COLLECTED');
        setPan('');

        // Saving the PAN is not the same as having somewhere to be paid. Say
        // so plainly instead of reporting success and leaving the driver to
        // find out when no money arrives.
        if (panData.linked === false && panData.message) {
          setNeedsEmail(panData.link_blocked === 'EMAIL_REQUIRED');
          haptics.warning();
          Alert.alert('One more thing', panData.message);
          setSaving(false);
          return;
        }
        setNeedsEmail(false);
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
      setIsEditingDetails(false);
      setAccountNumber('');
      setConfirmAccount('');
      Alert.alert(
        'Payout details saved ✓',
        `Your details are securely saved. Payouts will be sent to ${data.destination}.`
      );
      refresh();
    } catch {
      haptics.error();
      Alert.alert('Could not save', 'Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const renderStageIcon = (status: PayoutStage['status']) => {
    if (status === 'COMPLETED') return <CheckCircle2 color={c.goStrong} size={20} strokeWidth={2.5} />;
    if (status === 'CURRENT') return <ActivityIndicator size="small" color={c.accent} />;
    if (status === 'FAILED') return <AlertCircle color={c.danger} size={20} strokeWidth={2.5} />;
    return <Clock color={c.textDisabled} size={20} strokeWidth={2} />;
  };

  const renderStatusBadge = (status: HistoricalPayout['status']) => {
    if (status === 'COMPLETED') return <View style={[styles.badge, styles.badgeSuccess]}><Text style={styles.badgeTextSuccess}>Credited ✓</Text></View>;
    if (status === 'PROCESSING') return <View style={[styles.badge, styles.badgePending]}><Text style={styles.badgeTextPending}>In Transit ⚡</Text></View>;
    if (status === 'FAILED') return <View style={[styles.badge, styles.badgeDanger]}><Text style={styles.badgeTextDanger}>Failed</Text></View>;
    return <View style={[styles.badge, styles.badgeNeutral]}><Text style={styles.badgeTextNeutral}>Initiated</Text></View>;
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" backgroundColor={c.bgApp} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <HapticPressable style={styles.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/wallet'))}>
          <Text style={styles.backText}>← Back to Wallet</Text>
        </HapticPressable>

        <Text style={styles.h1}>Payouts & Bank</Text>
        <Text style={styles.sub}>
          Withdraw your earnings to your bank account or UPI ID. Your details stay saved so you can withdraw anytime.
        </Text>

        {/* 1. FUND VALUE & WITHDRAWAL CALCULATOR CARD */}
        <View style={styles.fundCard}>
          <View style={styles.fundHeader}>
            <View>
              <Text style={styles.fundSub}>Available Fund Value</Text>
              <Text style={styles.fundAmount}>{formatMoney(balance, { decimals: 2 })}</Text>
            </View>
            <View style={styles.shieldBadge}>
              <ShieldCheck color={c.goStrong} size={16} />
              <Text style={styles.shieldText}>Instant Ready</Text>
            </View>
          </View>

          {balance > 0 && current?.configured && (
            <View style={styles.withdrawSection}>
              <Text style={styles.withdrawSectionLabel}>Withdrawal Amount</Text>
              <View style={styles.amountInputRow}>
                <Text style={styles.rupeeSymbol}>₹</Text>
                <TextInput
                  style={styles.amountInput}
                  value={withdrawAmount}
                  onChangeText={(t) => setWithdrawAmount(t.replace(/[^0-9.]/g, ''))}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={c.textDisabled}
                />
              </View>

              {/* Quick % Chips */}
              <View style={styles.chipsRow}>
                {[0.25, 0.5, 1].map((ratio) => {
                  const val = Math.floor(balance * ratio);
                  const isSelected = Math.abs(numericAmount - val) < 0.01;
                  return (
                    <HapticPressable
                      key={ratio}
                      style={[styles.chip, isSelected && styles.chipSelected]}
                      onPress={() => setWithdrawAmount(String(val))}
                    >
                      <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                        {ratio === 1 ? '100% (All)' : `${ratio * 100}%`}
                      </Text>
                    </HapticPressable>
                  );
                })}
              </View>

              {/* Breakdown */}
              <View style={styles.breakdownBox}>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Transfer Amount</Text>
                  <Text style={styles.breakdownVal}>{formatMoney(numericAmount, { decimals: 2 })}</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Platform Fee</Text>
                  <Text style={[styles.breakdownVal, { color: c.goStrong }]}>₹0.00 (Free)</Text>
                </View>
                <View style={[styles.breakdownRow, { borderTopWidth: 1, borderTopColor: c.borderSubtle, paddingTop: 6, marginTop: 4 }]}>
                  <Text style={styles.breakdownTotalLabel}>Net Credited to Account</Text>
                  <Text style={styles.breakdownTotalVal}>{formatMoney(numericAmount, { decimals: 2 })}</Text>
                </View>
                <View style={styles.destPreviewRow}>
                  <Text style={styles.destPreviewText}>Destination: <Text style={{ fontFamily: font.monoBold, color: c.textPrimary }}>{current.destination}</Text></Text>
                </View>
              </View>

              {/* Withdraw Button */}
              {current.payouts_available !== false ? (
                <HapticPressable
                  haptic="press"
                  style={[styles.withdrawActionBtn, (!isAmountValid || withdrawing) && styles.disabled]}
                  onPress={handleWithdraw}
                  disabled={!isAmountValid || withdrawing}
                >
                  {withdrawing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <View style={styles.withdrawBtnContent}>
                      <ArrowUpRight color="#fff" size={18} strokeWidth={2.5} />
                      <Text style={styles.withdrawActionBtnText}>
                        Initiate Withdrawal of {formatMoney(numericAmount, { decimals: 2 })}
                      </Text>
                    </View>
                  )}
                </HapticPressable>
              ) : (
                <Text style={styles.payoutsOffNote}>
                  Withdrawing to a bank or UPI isn't available yet — we're still setting up
                  the payout rails with our provider, and we don't have a date. Your balance
                  is safe and spendable on rides. Once your PAN is on file, earnings from
                  new rides go straight to your bank instead of the wallet.
                </Text>
              )}
            </View>
          )}

          {balance === 0 && (
            <Text style={styles.zeroBalanceNote}>
              You currently have no withdrawable balance. Earnings from completed rides will appear here automatically.
            </Text>
          )}
        </View>

        {/* 2. LIVE PAYOUT TRACKER (ACTIVE / RECENT WITHDRAWAL) */}
        {activeTracking && (
          <View style={styles.trackerCard}>
            <View style={styles.trackerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.trackerSub}>Live Payout Tracking</Text>
                <Text style={styles.trackerAmount}>{formatMoney(activeTracking.amount, { decimals: 2 })}</Text>
              </View>
              {renderStatusBadge(activeTracking.status)}
            </View>

            <View style={styles.etaBox}>
              <Sparkles color={c.accent} size={15} />
              <Text style={styles.etaText}>
                Estimated Arrival: <Text style={{ fontFamily: font.sansBold, color: c.textPrimary }}>{activeTracking.estimated_arrival}</Text>
              </Text>
            </View>

            <Text style={styles.trackerDestText}>
              Destination: <Text style={{ fontFamily: font.monoBold, color: c.textPrimary }}>{activeTracking.destination}</Text>
            </Text>

            {/* Stepper Timeline */}
            <View style={styles.stepperContainer}>
              {activeTracking.stages.map((stage, idx) => {
                const isLast = idx === activeTracking.stages.length - 1;
                return (
                  <View key={stage.id} style={styles.stepRow}>
                    <View style={styles.stepIndicatorCol}>
                      {renderStageIcon(stage.status)}
                      {!isLast && <View style={[styles.stepLine, stage.status === 'COMPLETED' && styles.stepLineActive]} />}
                    </View>
                    <View style={styles.stepContentCol}>
                      <Text style={[styles.stepLabel, stage.status === 'CURRENT' && { color: c.accent }]}>
                        {stage.label}
                      </Text>
                      <Text style={styles.stepDesc}>{stage.description}</Text>
                      {stage.timestamp && (
                        <Text style={styles.stepTime}>
                          {new Date(stage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {new Date(stage.timestamp).toLocaleDateString()}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>

            {activeTracking.transaction_ref && (
              <Text style={styles.refText}>Ref: {activeTracking.transaction_ref}</Text>
            )}
          </View>
        )}

        {/* 3. SAVED ACCOUNT & PAN DETAILS (PERSISTENT & EDITABLE) */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Account Details & PAN</Text>
          {current?.configured && !isEditingDetails && (
            <HapticPressable onPress={() => setIsEditingDetails(true)}>
              <Text style={styles.editBtnText}>Edit Details</Text>
            </HapticPressable>
          )}
        </View>

        {current?.configured && !isEditingDetails ? (
          <View style={styles.savedCard}>
            <View style={styles.savedRow}>
              {current.saved_details?.type === 'BANK_ACCOUNT' ? (
                <Landmark color={c.goStrong} size={22} />
              ) : (
                <Smartphone color={c.goStrong} size={22} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.savedLabel}>
                  {current.saved_details?.type === 'BANK_ACCOUNT' ? 'Bank Account' : 'UPI ID'}
                </Text>
                <Text style={styles.savedDest}>{current.destination}</Text>
                {current.saved_details?.name && (
                  <Text style={styles.savedHolder}>{current.saved_details.name}</Text>
                )}
              </View>
              <View style={styles.savedCheck}>
                <Check color="#fff" size={14} strokeWidth={3} />
              </View>
            </View>

            {panOnFile && (
              <View style={styles.panBadgeRow}>
                <ShieldCheck color={c.goStrong} size={15} />
                <Text style={styles.panBadgeText}>PAN Verified: {panOnFile}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.formCard}>
            {/* PAN Number */}
            <Text style={styles.label}>PAN Number</Text>
            {kycStatus === 'LINKED' ? (
              <View style={styles.panDone}>
                <Text style={styles.panDoneText}>✓ {panOnFile} — Verified & Linked</Text>
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
                  <Text style={styles.err}>A PAN is 10 characters in the format ABCDE1234F.</Text>
                )}
                <Text style={styles.panNote}>
                  {panOnFile
                    ? 'Your PAN is securely saved on file.'
                    : 'Required for RBI bank settlement. No document upload required.'}
                </Text>
              </>
            )}

            {/* Type Selector: UPI or Bank Account */}
            {/* Email, only when Razorpay still needs one. Phone-OTP accounts have
            no email on file, and without it no payout account can be opened —
            which is exactly how the first real PAN submission stalled without
            anyone noticing. */}
        {needsEmail && kycStatus !== 'LINKED' && (
          <>
            <Text style={styles.label}>Email address</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={c.textDisabled}
              value={payoutEmail}
              onChangeText={setPayoutEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              maxLength={120}
            />
            <Text style={styles.panNote}>
              Razorpay needs this to open your payout account and send settlement
              notices. We don't use it for marketing.
            </Text>
          </>
        )}

        <View style={styles.typeRow}>
              <HapticPressable
                style={[styles.typeBtn, type === 'VPA' && styles.typeBtnOn]}
                onPress={() => setType('VPA')}
              >
                <Text style={[styles.typeText, type === 'VPA' && styles.typeTextOn]}>UPI ID</Text>
              </HapticPressable>
              <HapticPressable
                style={[styles.typeBtn, type === 'BANK_ACCOUNT' && styles.typeBtnOn]}
                onPress={() => setType('BANK_ACCOUNT')}
              >
                <Text style={[styles.typeText, type === 'BANK_ACCOUNT' && styles.typeTextOn]}>Bank Account</Text>
              </HapticPressable>
            </View>

            {type === 'VPA' ? (
              <>
                <Text style={styles.label}>UPI ID (VPA)</Text>
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
                {vpa.length > 0 && !vpaOk && <Text style={styles.err}>Please enter a valid UPI ID (e.g. name@bank).</Text>}
              </>
            ) : (
              <>
                <Text style={styles.label}>Account Holder Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="As printed on your bank account"
                  placeholderTextColor={c.textDisabled}
                  value={holderName}
                  onChangeText={setHolderName}
                  maxLength={60}
                />

                <Text style={styles.label}>Bank Account Number</Text>
                <TextInput
                  style={styles.input}
                  placeholder={current?.saved_details?.account_number_masked ? `Current: ${current.saved_details.account_number_masked}` : 'Account number'}
                  placeholderTextColor={c.textDisabled}
                  value={accountNumber}
                  onChangeText={(t) => setAccountNumber(t.replace(/[^\d\s]/g, ''))}
                  keyboardType="number-pad"
                  maxLength={22}
                />

                <Text style={styles.label}>Confirm Account Number</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Re-enter account number"
                  placeholderTextColor={c.textDisabled}
                  value={confirmAccount}
                  onChangeText={(t) => setConfirmAccount(t.replace(/[^\d\s]/g, ''))}
                  keyboardType="number-pad"
                  maxLength={22}
                  contextMenuHidden
                />
                {confirmAccount.length > 0 && !accMatches && (
                  <Text style={styles.err}>Account numbers do not match.</Text>
                )}

                <Text style={styles.label}>IFSC Code</Text>
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
                {ifsc.length > 0 && !ifscOk && <Text style={styles.err}>IFSC is 4 letters, 0, then 6 characters.</Text>}
              </>
            )}

            <HapticPressable
              haptic="press"
              style={[styles.primaryBtn, (!canSave || saving) && styles.disabled]}
              onPress={saveDetails}
              disabled={!canSave || saving}
            >
              {saving ? (
                <ActivityIndicator color={c.actionPrimaryText} />
              ) : (
                <Text style={styles.primaryBtnText}>Save & Persist Details</Text>
              )}
            </HapticPressable>

            {current?.configured && (
              <HapticPressable style={styles.cancelEditBtn} onPress={() => setIsEditingDetails(false)}>
                <Text style={styles.cancelEditText}>Cancel & Keep Saved Details</Text>
              </HapticPressable>
            )}
          </View>
        )}

        {/* 4. HISTORICAL PAYMENT RECORDS (6+ MONTHS) */}
        <View style={styles.historySectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <History color={c.textPrimary} size={18} />
            <Text style={styles.sectionTitle}>Payment History (Last 6 Months)</Text>
          </View>
          <HapticPressable onPress={refresh} style={styles.refreshBtn}>
            <RefreshCw color={c.textSecondary} size={14} />
          </HapticPressable>
        </View>

        {loadingHistory ? (
          <ActivityIndicator color={c.accent} style={{ marginVertical: 20 }} />
        ) : history.length === 0 ? (
          <View style={styles.emptyHistoryCard}>
            <Text style={styles.emptyHistoryText}>No past withdrawal records found.</Text>
          </View>
        ) : (
          <View style={styles.historyList}>
            {history.map((item) => {
              const isExpanded = expandedPayoutId === item.id;
              return (
                <HapticPressable
                  key={item.id}
                  style={styles.historyCard}
                  onPress={() => setExpandedPayoutId(isExpanded ? null : item.id)}
                  activeOpacity={0.9}
                >
                  <View style={styles.historyCardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyAmount}>{formatMoney(item.amount, { decimals: 2 })}</Text>
                      <Text style={styles.historyDest}>{item.destination}</Text>
                      <Text style={styles.historyDate}>
                        {item.created_at ? new Date(item.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      {renderStatusBadge(item.status)}
                      {isExpanded ? (
                        <ChevronUp color={c.textTertiary} size={16} />
                      ) : (
                        <ChevronDown color={c.textTertiary} size={16} />
                      )}
                    </View>
                  </View>

                  {/* Expanded Stage Tracker */}
                  {isExpanded && (
                    <View style={styles.historyExpanded}>
                      <View style={styles.expandedDivider} />
                      <Text style={styles.expandedHeading}>Stage Tracking</Text>
                      <View style={styles.stepperContainer}>
                        {item.stages.map((stage, idx) => {
                          const isLast = idx === item.stages.length - 1;
                          return (
                            <View key={stage.id} style={styles.stepRow}>
                              <View style={styles.stepIndicatorCol}>
                                {renderStageIcon(stage.status)}
                                {!isLast && <View style={[styles.stepLine, stage.status === 'COMPLETED' && styles.stepLineActive]} />}
                              </View>
                              <View style={styles.stepContentCol}>
                                <Text style={[styles.stepLabel, stage.status === 'CURRENT' && { color: c.accent }]}>
                                  {stage.label}
                                </Text>
                                <Text style={styles.stepDesc}>{stage.description}</Text>
                                {stage.timestamp && (
                                  <Text style={styles.stepTime}>
                                    {new Date(stage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {new Date(stage.timestamp).toLocaleDateString()}
                                  </Text>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                      {item.transaction_ref && (
                        <Text style={styles.refText}>Reference ID: {item.transaction_ref}</Text>
                      )}
                    </View>
                  )}
                </HapticPressable>
              );
            })}
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  content: { flexGrow: 1, paddingHorizontal: space.lg },
  back: { paddingVertical: 8, alignSelf: 'flex-start' },
  backText: { fontFamily: font.sansSemibold, fontSize: 14.5, color: c.textSecondary },
  h1: { fontFamily: font.sansExtrabold, fontSize: 26, color: c.textPrimary, letterSpacing: -0.5, marginTop: space.sm },
  sub: { fontFamily: font.sans, fontSize: 13.5, color: c.textTertiary, marginTop: 4, lineHeight: 19, marginBottom: space.md },

  // Fund Card
  fundCard: {
    backgroundColor: c.textPrimary, borderRadius: radius.xl, padding: space.lg, marginBottom: space.lg, ...shadowSm,
  },
  fundHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  fundSub: { fontFamily: font.sansMedium, fontSize: 12.5, color: 'rgba(255,255,255,0.65)' },
  fundAmount: { fontFamily: font.monoBold, fontSize: 32, color: '#fff', marginTop: 4, letterSpacing: -0.5 },
  shieldBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(22, 163, 74, 0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
  },
  shieldText: { fontFamily: font.sansSemibold, fontSize: 11.5, color: '#4ade80' },
  withdrawSection: { marginTop: space.md, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', paddingTop: space.md },
  withdrawSectionLabel: { fontFamily: font.sansSemibold, fontSize: 12.5, color: 'rgba(255,255,255,0.8)', marginBottom: 8 },
  amountInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.md, paddingHorizontal: 14, height: 50,
  },
  rupeeSymbol: { fontFamily: font.monoBold, fontSize: 22, color: '#fff' },
  amountInput: { flex: 1, fontFamily: font.monoBold, fontSize: 22, color: '#fff', padding: 0 },
  chipsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chip: {
    flex: 1, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  chipSelected: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { fontFamily: font.sansSemibold, fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  chipTextSelected: { color: c.textPrimary },

  breakdownBox: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: radius.md, padding: 12, marginTop: 12, gap: 6,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdownLabel: { fontFamily: font.sans, fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  breakdownVal: { fontFamily: font.mono, fontSize: 12.5, color: '#fff' },
  breakdownTotalLabel: { fontFamily: font.sansBold, fontSize: 13, color: '#fff' },
  breakdownTotalVal: { fontFamily: font.monoBold, fontSize: 14, color: '#4ade80' },
  destPreviewRow: { marginTop: 4 },
  destPreviewText: { fontFamily: font.sans, fontSize: 11.5, color: 'rgba(255,255,255,0.6)' },
  withdrawActionBtn: {
    backgroundColor: c.goStrong, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: 14,
  },
  withdrawBtnContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  withdrawActionBtnText: { fontFamily: font.sansBold, fontSize: 14.5, color: '#fff' },
  payoutsOffNote: { fontFamily: font.sans, fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 8, lineHeight: 16 },
  zeroBalanceNote: { fontFamily: font.sans, fontSize: 12.5, color: 'rgba(255,255,255,0.65)', marginTop: 10, lineHeight: 17 },

  // Live Tracker Card
  trackerCard: {
    backgroundColor: c.surfaceCard, borderRadius: radius.lg, padding: space.lg, marginBottom: space.lg,
    borderWidth: 1.5, borderColor: c.accent, ...shadowSm,
  },
  trackerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  trackerSub: { fontFamily: font.sansSemibold, fontSize: 12, color: c.accent, textTransform: 'uppercase', letterSpacing: 0.5 },
  trackerAmount: { fontFamily: font.monoBold, fontSize: 22, color: c.textPrimary, marginTop: 2 },
  etaBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.accentSoft, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, marginBottom: 8,
  },
  etaText: { fontFamily: font.sans, fontSize: 12, color: c.textSecondary },
  trackerDestText: { fontFamily: font.sans, fontSize: 12.5, color: c.textSecondary, marginBottom: 12 },
  stepperContainer: { marginTop: 6 },
  stepRow: { flexDirection: 'row', gap: 12 },
  stepIndicatorCol: { alignItems: 'center', width: 22 },
  stepLine: { width: 2, flex: 1, backgroundColor: c.borderSubtle, marginVertical: 4 },
  stepLineActive: { backgroundColor: c.goStrong },
  stepContentCol: { flex: 1, paddingBottom: 14 },
  stepLabel: { fontFamily: font.sansBold, fontSize: 13.5, color: c.textPrimary },
  stepDesc: { fontFamily: font.sans, fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
  stepTime: { fontFamily: font.mono, fontSize: 11, color: c.textTertiary, marginTop: 2 },
  refText: { fontFamily: font.mono, fontSize: 11, color: c.textTertiary, marginTop: 8 },

  // Saved Details Card
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  sectionTitle: { fontFamily: font.sansBold, fontSize: 15, color: c.textPrimary },
  editBtnText: { fontFamily: font.sansBold, fontSize: 13, color: c.accent },
  savedCard: {
    backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.md, marginBottom: space.lg,
    borderWidth: 1, borderColor: c.borderDefault, gap: 10,
  },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  savedLabel: { fontFamily: font.sansMedium, fontSize: 12, color: c.textTertiary },
  savedDest: { fontFamily: font.monoBold, fontSize: 15, color: c.textPrimary, marginTop: 2 },
  savedHolder: { fontFamily: font.sans, fontSize: 12.5, color: c.textSecondary, marginTop: 1 },
  savedCheck: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.goStrong, alignItems: 'center', justifyContent: 'center' },
  panBadgeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.goSoft, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm,
  },
  panBadgeText: { fontFamily: font.sansSemibold, fontSize: 12, color: c.goStrong },

  // Form Card
  formCard: {
    backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.md, marginBottom: space.lg,
    borderWidth: 1, borderColor: c.borderDefault,
  },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: space.md },
  typeBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderDefault, alignItems: 'center', backgroundColor: c.bgApp },
  typeBtnOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
  typeText: { fontFamily: font.sansSemibold, fontSize: 13.5, color: c.textSecondary },
  typeTextOn: { color: c.textAccent },
  label: { fontFamily: font.sansSemibold, fontSize: 12.5, color: c.textPrimary, marginBottom: 5 },
  input: {
    backgroundColor: c.bgApp, borderRadius: radius.md, height: 48, paddingHorizontal: 14,
    fontFamily: font.monoBold, fontSize: 15, color: c.textPrimary,
    borderWidth: 1, borderColor: c.borderDefault, marginBottom: space.sm,
  },
  err: { fontFamily: font.sans, fontSize: 11.5, color: c.danger, marginTop: -4, marginBottom: space.sm },
  panNote: { fontFamily: font.sans, fontSize: 11.5, color: c.textTertiary, marginTop: -2, marginBottom: space.md, lineHeight: 16 },
  panDone: {
    borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, marginBottom: space.md,
    backgroundColor: c.goSoft, borderWidth: 1, borderColor: c.goSoft,
  },
  panDoneText: { fontFamily: font.sansSemibold, fontSize: 12.5, color: c.goStrong },
  primaryBtn: { backgroundColor: c.actionPrimary, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: space.sm },
  primaryBtnText: { fontFamily: font.sansBold, fontSize: 14.5, color: c.actionPrimaryText },
  cancelEditBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  cancelEditText: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textTertiary },

  // History Section
  historySectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.md, marginBottom: space.sm },
  refreshBtn: { padding: 4 },
  emptyHistoryCard: { backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.lg, alignItems: 'center', borderWidth: 1, borderColor: c.borderSubtle },
  emptyHistoryText: { fontFamily: font.sans, fontSize: 13, color: c.textTertiary },
  historyList: { gap: space.sm },
  historyCard: {
    backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: c.borderDefault, ...shadowSm,
  },
  historyCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyAmount: { fontFamily: font.monoBold, fontSize: 16, color: c.textPrimary },
  historyDest: { fontFamily: font.sans, fontSize: 12.5, color: c.textSecondary, marginTop: 2 },
  historyDate: { fontFamily: font.mono, fontSize: 11, color: c.textTertiary, marginTop: 2 },
  historyExpanded: { marginTop: space.sm },
  expandedDivider: { height: 1, backgroundColor: c.borderSubtle, marginVertical: space.sm },
  expandedHeading: { fontFamily: font.sansBold, fontSize: 12, color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },

  // Badges
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  badgeSuccess: { backgroundColor: c.goSoft },
  badgeTextSuccess: { fontFamily: font.sansBold, fontSize: 11, color: c.goStrong },
  badgePending: { backgroundColor: c.accentSoft },
  badgeTextPending: { fontFamily: font.sansBold, fontSize: 11, color: c.accent },
  badgeDanger: { backgroundColor: c.dangerSoft },
  badgeTextDanger: { fontFamily: font.sansBold, fontSize: 11, color: c.danger },
  badgeNeutral: { backgroundColor: c.surfaceSunken },
  badgeTextNeutral: { fontFamily: font.sansBold, fontSize: 11, color: c.textTertiary },

  disabled: { opacity: 0.5 },
});

