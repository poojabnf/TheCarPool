import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Route } from 'lucide-react-native';
import { c, font, radius, space } from '../../theme/tokens';

/**
 * Trips — upcoming and past rides. Phase-1 shell (on-brand); the live-trip
 * tracking + history list land in the next redesign pass.
 */
export default function TripsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.lg }]}>
      <Text style={styles.h1}>Trips</Text>
      <View style={styles.empty}>
        <View style={styles.iconWrap}>
          <Route color={c.textTertiary} size={28} strokeWidth={2} />
        </View>
        <Text style={styles.emptyTitle}>No trips yet</Text>
        <Text style={styles.emptySub}>Book a shared ride and it'll show up here — live tracking, ETA and trip history.</Text>
        <TouchableOpacity style={styles.cta} activeOpacity={0.9} onPress={() => router.push('/(tabs)')}>
          <Text style={styles.ctaText}>Find a ride</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp, paddingHorizontal: space.xl },
  h1: { fontFamily: font.sansExtrabold, fontSize: 28, color: c.textPrimary, letterSpacing: -0.5 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  iconWrap: {
    width: 72, height: 72, borderRadius: radius.xl, backgroundColor: c.surfaceInset,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.lg,
  },
  emptyTitle: { fontFamily: font.sansBold, fontSize: 18, color: c.textPrimary },
  emptySub: { fontFamily: font.sans, fontSize: 13.5, color: c.textTertiary, textAlign: 'center', lineHeight: 20, marginTop: 6, maxWidth: 280 },
  cta: { backgroundColor: c.actionPrimary, borderRadius: radius.md, paddingHorizontal: space.xl, height: 46, justifyContent: 'center', marginTop: space.xl },
  ctaText: { fontFamily: font.sansBold, fontSize: 15, color: c.actionPrimaryText },
});
