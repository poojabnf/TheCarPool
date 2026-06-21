import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mic, Check, Clock, X } from 'lucide-react-native';
import { c, font, radius, space } from '../../theme/tokens';

export default function AiVoiceModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState('Calling now');
  const [seconds, setSeconds] = useState(0);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const t1 = setTimeout(() => setStatus('Confirming your 8:30 ride with Rajesh'), 2000);
    const t2 = setTimeout(() => setStatus('Reply by voice, or tap below'), 5000);
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.12, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
    ])).start();
    return () => { clearTimeout(t1); clearTimeout(t2); clearInterval(tick); };
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
      <View style={styles.handle} />
      <Text style={styles.title}>TheCarPool Assistant</Text>
      <Text style={styles.timer}>{status === 'Calling now' ? `Calling now · ${mm}:${ss}` : `Live · ${mm}:${ss}`}</Text>

      <View style={styles.center}>
        <Animated.View style={[styles.pulse, { transform: [{ scale: pulse }] }]}>
          <View style={styles.mic}><Mic color="#fff" size={32} strokeWidth={2.2} /></View>
        </Animated.View>
        <Text style={styles.status}>{status}</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.action, styles.confirm]} onPress={() => router.back()} activeOpacity={0.9}>
          <Check color="#fff" size={18} strokeWidth={2.6} /><Text style={styles.confirmText}>Confirm ride</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.action, styles.secondary]} onPress={() => router.back()} activeOpacity={0.9}>
          <Clock color={c.textPrimary} size={17} strokeWidth={2.2} /><Text style={styles.secondaryText}>Delay 10 min</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.cancel} onPress={() => router.back()}>
        <X color={c.danger} size={16} strokeWidth={2.4} /><Text style={styles.cancelText}>Cancel call</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgBase, alignItems: 'center', paddingHorizontal: space.xl, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginBottom: space.lg },
  title: { fontFamily: font.sansExtrabold, fontSize: 20, color: c.textPrimary },
  timer: { fontFamily: font.mono, fontSize: 13, color: c.textTertiary, marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pulse: { width: 130, height: 130, borderRadius: 65, backgroundColor: c.goSoft, alignItems: 'center', justifyContent: 'center', marginBottom: space.xl },
  mic: { width: 78, height: 78, borderRadius: 39, backgroundColor: c.go, alignItems: 'center', justifyContent: 'center' },
  status: { fontFamily: font.sansSemibold, fontSize: 16, color: c.textPrimary, textAlign: 'center', maxWidth: 280, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: space.sm, alignSelf: 'stretch' },
  action: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', height: 52, borderRadius: radius.md },
  confirm: { backgroundColor: c.go },
  confirmText: { fontFamily: font.sansBold, fontSize: 15, color: '#fff' },
  secondary: { backgroundColor: c.surfaceCard, borderWidth: 1, borderColor: c.borderStrong },
  secondaryText: { fontFamily: font.sansBold, fontSize: 14.5, color: c.textPrimary },
  cancel: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: space.md, padding: space.md },
  cancelText: { fontFamily: font.sansSemibold, fontSize: 14, color: c.danger },
});
