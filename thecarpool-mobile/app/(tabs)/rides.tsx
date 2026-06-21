import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, PlusCircle, ChevronRight } from 'lucide-react-native';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';

/**
 * Rides — the Find + Offer hub. Riders search from Home; this hub routes to
 * either the search Home or the driver "offer a ride" flow.
 */
export default function RidesHub() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.lg }}>
      <Text style={styles.h1}>Rides</Text>
      <Text style={styles.sub}>Find a shared ride, or offer your seats.</Text>

      <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={() => router.push('/(tabs)')}>
        <View style={[styles.iconWrap, { backgroundColor: c.goSoft }]}>
          <Search color={c.goStrong} size={22} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Find a ride</Text>
          <Text style={styles.cardSub}>Search verified drivers on your route</Text>
        </View>
        <ChevronRight color={c.textDisabled} size={20} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={() => router.push('/(tabs)/driver')}>
        <View style={[styles.iconWrap, { backgroundColor: c.accentSoft }]}>
          <PlusCircle color={c.textAccent} size={22} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Offer a ride</Text>
          <Text style={styles.cardSub}>Share your commute and split the fare</Text>
        </View>
        <ChevronRight color={c.textDisabled} size={20} />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  h1: { fontFamily: font.sansExtrabold, fontSize: 28, color: c.textPrimary, letterSpacing: -0.5 },
  sub: { fontFamily: font.sans, fontSize: 14, color: c.textTertiary, marginTop: 4, marginBottom: space.xl },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: c.surfaceCard, borderRadius: radius.lg, padding: space.lg,
    borderWidth: 1, borderColor: c.borderSubtle, marginBottom: space.md, ...shadowSm,
  },
  iconWrap: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: font.sansBold, fontSize: 16, color: c.textPrimary },
  cardSub: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary, marginTop: 2 },
});
