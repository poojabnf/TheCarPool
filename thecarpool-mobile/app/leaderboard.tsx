import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Leaf, Trophy } from 'lucide-react-native';
import { apiFetch } from './services/api';
import { c, font, radius, space, shadowSm } from '../theme/tokens';

type Entry = { rank: number; name: string; co2_saved_kg: number; matches: number; points: number };

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await apiFetch('/api/sustainability/leaderboard');
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data) ? data : []);
      }
    } catch { /* keep last data */ }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Green leaderboard</Text>
          <Text style={styles.subtitle}>Top commuters by CO₂ saved</Text>
        </View>
        <Trophy color={c.accent} size={22} strokeWidth={2} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={c.go} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={c.go} />}
        >
          {entries.map((e) => (
            <View key={e.rank} style={[styles.row, e.rank <= 3 && styles.rowTop]}>
              <Text style={styles.rank}>{e.rank <= 3 ? MEDALS[e.rank - 1] : `#${e.rank}`}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{e.name}</Text>
                <Text style={styles.meta}>{e.matches} shared rides</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <View style={styles.co2Pill}>
                  <Leaf color={c.goStrong} size={12} strokeWidth={2.4} />
                  <Text style={styles.co2Text}>{e.co2_saved_kg} kg</Text>
                </View>
                <Text style={styles.points}>{e.points} pts</Text>
              </View>
            </View>
          ))}
          {entries.length === 0 && (
            <Text style={styles.empty}>No completed rides yet — the podium is wide open. 🌱</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.xl, paddingBottom: space.md,
  },
  back: { fontSize: 24, color: c.textPrimary, paddingRight: 4 },
  title: { fontFamily: font.sansBold, fontSize: 18, color: c.textPrimary },
  subtitle: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary, marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: c.surfaceCard, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: c.borderSubtle, marginBottom: space.sm, ...shadowSm,
  },
  rowTop: { borderColor: c.accent },
  rank: { fontFamily: font.monoBold, fontSize: 16, width: 40, textAlign: 'center', color: c.textSecondary },
  name: { fontFamily: font.sansSemibold, fontSize: 14.5, color: c.textPrimary },
  meta: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginTop: 1 },
  co2Pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.goSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  co2Text: { fontFamily: font.monoBold, fontSize: 12, color: c.goStrong },
  points: { fontFamily: font.sans, fontSize: 11, color: c.textTertiary, marginTop: 3 },
  empty: { fontFamily: font.sans, fontSize: 13.5, color: c.textTertiary, textAlign: 'center', marginTop: 40 },
});
