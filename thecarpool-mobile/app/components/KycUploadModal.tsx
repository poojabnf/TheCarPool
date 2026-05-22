import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Camera, CheckCircle, X } from 'lucide-react-native';

export default function KycUploadModal() {
  const router = useRouter();
  const [status, setStatus] = useState<'pending' | 'uploading' | 'verified'>('pending');

  const handleUpload = () => {
    setStatus('uploading');
    // Simulate S3 / AI OCR processing
    setTimeout(() => {
      setStatus('verified');
    }, 2500);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
        <X color="#64748b" size={24} />
      </TouchableOpacity>
      
      <Text style={styles.title}>Action Required</Text>
      <Text style={styles.subText}>You must verify your identity with a Government ID before booking your first ride.</Text>

      <View style={styles.uploadArea}>
        {status === 'pending' && (
          <>
            <Camera color="#94a3b8" size={48} style={{ marginBottom: 16 }} />
            <Text style={styles.uploadText}>Tap to scan Govt ID</Text>
            <TouchableOpacity style={styles.actionBtn} onPress={handleUpload}>
              <Text style={styles.actionBtnText}>Open Camera</Text>
            </TouchableOpacity>
          </>
        )}

        {status === 'uploading' && (
          <View style={styles.centerBox}>
            <Camera color="#3b82f6" size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
            <Text style={[styles.uploadText, { color: '#3b82f6' }]}>Verifying via AI OCR...</Text>
          </View>
        )}

        {status === 'verified' && (
          <View style={styles.centerBox}>
            <CheckCircle color="#10b981" size={56} style={{ marginBottom: 16 }} />
            <Text style={[styles.uploadText, { color: '#10b981', fontWeight: 'bold' }]}>Verification Successful</Text>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#10b981', marginTop: 20 }]} onPress={() => router.back()}>
              <Text style={styles.actionBtnText}>Continue to Booking</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff', padding: 24, paddingTop: 60 },
  closeBtn: { alignSelf: 'flex-end', padding: 8 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#0f172a', marginBottom: 8 },
  subText: { fontSize: 16, color: '#64748b', marginBottom: 40, lineHeight: 24 },
  uploadArea: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 24, borderWidth: 2, borderColor: '#e2e8f0', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', padding: 20 },
  uploadText: { fontSize: 18, color: '#64748b', marginBottom: 24 },
  actionBtn: { backgroundColor: '#0f172a', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12 },
  actionBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  centerBox: { alignItems: 'center' }
});
