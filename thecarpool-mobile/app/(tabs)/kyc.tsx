import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Image, ActivityIndicator } from 'react-native';

export default function KycScreen() {
  const [rcScanned, setRcScanned] = useState(false);
  const [faceVerified, setFaceVerified] = useState(false);
  const [upiLinked, setUpiLinked] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const handleDocumentScan = () => {
    setLoading('ocr');
    setTimeout(() => {
      setLoading(null);
      setRcScanned(true);
      Alert.alert(
        'OCR Extraction Complete ✓',
        'Extracted Vehicle Make: Hyundai i20\nReg Year: 2023\nPlate: DL 3C BC 8712'
      );
    }, 1800);
  };

  const handleFaceMatch = () => {
    setLoading('face');
    setTimeout(() => {
      setLoading(null);
      setFaceVerified(true);
      Alert.alert(
        'Aadhaar Biometric Match ✓',
        'Facial symmetry verified with Government Aadhaar registry matching profile (98.4% match confidence).'
      );
    }, 2000);
  };

  const handleUpiVerification = () => {
    setLoading('upi');
    setTimeout(() => {
      setLoading(null);
      setUpiLinked(true);
      Alert.alert(
        'UPI penny drop success ✓',
        'Deposited Re.1 to verify account. Account Holder: RAJESH KUMAR linked successfully.'
      );
    }, 1500);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trust & Safety KYC</Text>
      <Text style={styles.subtitle}>Complete verification to post or search rides.</Text>

      {/* 1. Document OCR */}
      <View style={[styles.stepCard, rcScanned && styles.completedCard]}>
        <View style={styles.stepInfo}>
          <Text style={styles.stepNum}>1</Text>
          <View>
            <Text style={styles.stepTitle}>Vehicle Registration Card</Text>
            <Text style={styles.stepDesc}>{rcScanned ? 'Extracted successfully' : 'Scan R.C. via Computer Vision'}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.actionBtn} onPress={handleDocumentScan} disabled={rcScanned || !!loading}>
          {loading === 'ocr' ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>{rcScanned ? 'Done' : 'Scan document'}</Text>}
        </TouchableOpacity>
      </View>

      {/* 2. Facial Recognition */}
      <View style={[styles.stepCard, faceVerified && styles.completedCard]}>
        <View style={styles.stepInfo}>
          <Text style={styles.stepNum}>2</Text>
          <View>
            <Text style={styles.stepTitle}>Aadhaar Selfie Match</Text>
            <Text style={styles.stepDesc}>{faceVerified ? 'Liveness and identity verified' : 'Selfie biometric check'}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.actionBtn} onPress={handleFaceMatch} disabled={faceVerified || !!loading}>
          {loading === 'face' ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>{faceVerified ? 'Done' : 'Verify Liveness'}</Text>}
        </TouchableOpacity>
      </View>

      {/* 3. UPI Link */}
      <View style={[styles.stepCard, upiLinked && styles.completedCard]}>
        <View style={styles.stepInfo}>
          <Text style={styles.stepNum}>3</Text>
          <View>
            <Text style={styles.stepTitle}>UPI Payout Link</Text>
            <Text style={styles.stepDesc}>{upiLinked ? 'Bank verified' : 'Link UPI ID via penny deposit'}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.actionBtn} onPress={handleUpiVerification} disabled={upiLinked || !!loading}>
          {loading === 'upi' ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>{upiLinked ? 'Done' : 'Verify UPI ID'}</Text>}
        </TouchableOpacity>
      </View>

      {rcScanned && faceVerified && upiLinked && (
        <View style={styles.verifiedBox}>
          <Text style={styles.verifiedText}>🎉 Verification Complete. You are verified inside your Corporate Circle!</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080c14',
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 24,
  },
  stepCard: {
    backgroundColor: '#121b2d',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2d47',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  completedCard: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
  stepInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  stepNum: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ff6b35',
    backgroundColor: '#1f2d47',
    width: 32,
    height: 32,
    borderRadius: 16,
    textAlign: 'center',
    lineHeight: 32,
    marginRight: 12,
  },
  stepTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  stepDesc: {
    color: '#9ca3af',
    fontSize: 11,
    marginTop: 2,
  },
  actionBtn: {
    backgroundColor: '#ff6b35',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 90,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  verifiedBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#10b981',
    marginTop: 10,
  },
  verifiedText: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  }
});
