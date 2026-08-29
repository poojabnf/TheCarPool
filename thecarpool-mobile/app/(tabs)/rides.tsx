import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, PlusCircle, ChevronRight } from 'lucide-react-native';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';
import HapticPressable from '../components/HapticPressable';
import { useI18n } from '../services/i18n';

/**
 * Rides — the Find + Offer hub. Riders search from Home; this hub routes to
 * either the search Home or the driver "offer a ride" flow.
 */
export default function RidesHub() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.lg }}>
      <Text style={styles.h1}>{t('rides_title')}</Text>
      <Text style={styles.sub}>{t('rides_sub')}</Text>

      <HapticPressable style={styles.card} activeOpacity={0.9} onPress={() => router.push('/(tabs)')}>
        <View style={[styles.iconWrap, { backgroundColor: c.goSoft }]}>
          <Search color={c.goStrong} size={22} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t('find_a_ride')}</Text>
          <Text style={styles.cardSub}>{t('find_a_ride_sub')}</Text>
        </View>
        <ChevronRight color={c.textDisabled} size={20} />
      </HapticPressable>

      <HapticPressable style={styles.card} activeOpacity={0.9} onPress={() => router.push('/(tabs)/driver')}>
        <View style={[styles.iconWrap, { backgroundColor: c.accentSoft }]}>
          <PlusCircle color={c.textAccent} size={22} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t('offer_a_ride')}</Text>
          <Text style={styles.cardSub}>{t('offer_a_ride_sub')}</Text>
        </View>
        <ChevronRight color={c.textDisabled} size={20} />
      </HapticPressable>
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
