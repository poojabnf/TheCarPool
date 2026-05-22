import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';

export default function AiVoiceModal() {
  const router = useRouter();
  const [status, setStatus] = useState('Connecting to Clara (AI)...');

  // Simulate the background queue processing the voice job
  useEffect(() => {
    const timer1 = setTimeout(() => setStatus('Listening to Driver...'), 2000);
    const timer2 = setTimeout(() => setStatus('Driver confirmed delay of 2 mins.'), 5000);
    
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.dragger} />
      <Text style={styles.title}>AI Voice Gateway</Text>
      
      <View style={styles.pulseCircle}>
        <Text style={styles.pulseIcon}>🎙️</Text>
      </View>

      <Text style={styles.statusText}>{status}</Text>
      <Text style={styles.subText}>This call is being processed by the BullMQ background queue via Twilio & ElevenLabs.</Text>

      <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
        <Text style={styles.closeText}>Close Window</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121b2d',
    alignItems: 'center',
    paddingTop: 20,
    paddingHorizontal: 20,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
  },
  dragger: { width: 50, height: 5, backgroundColor: '#334155', borderRadius: 5, marginBottom: 20 },
  title: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 40 },
  pulseCircle: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#10b981',
    marginBottom: 40
  },
  pulseIcon: { fontSize: 40 },
  statusText: { color: '#10b981', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  subText: { color: '#64748b', fontSize: 14, textAlign: 'center', marginTop: 16, paddingHorizontal: 20 },
  closeButton: { marginTop: 'auto', marginBottom: 40, padding: 16, backgroundColor: '#1e293b', borderRadius: 12, width: '100%', alignItems: 'center' },
  closeText: { color: '#fff', fontWeight: 'bold', fontSize: 16 }
});
