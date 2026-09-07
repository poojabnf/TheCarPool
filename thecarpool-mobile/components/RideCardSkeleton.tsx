import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { c, radius, space, shadowSm } from '../theme/tokens';

/**
 * Placeholder ride cards, shown while a search is running.
 *
 * The results block was gated on having results, so between tapping Find and
 * the answer arriving -- measured at 0.6 to 2.9 seconds against production --
 * the screen showed nothing at all, then snapped to a full list. A rider had
 * no way to tell a slow search from one that had silently failed, and the
 * spinner that would have told them was inside the button they had just
 * stopped looking at.
 *
 * Shaped like the real card rather than generic bars, so the layout does not
 * jump when the content replaces it: same height, same rows in the same
 * places. The point is to promise the shape of what is coming.
 */

const PULSE_MS = 850;

function Shimmer({ style }: { style?: any }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: PULSE_MS, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  // Opacity rather than a moving gradient: it reads as "loading" just as
  // clearly and costs one interpolation instead of a masked layer per card.
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] });
  return <Animated.View style={[styles.bone, style, { opacity }]} />;
}

export default function RideCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.card} accessibilityLabel="Loading rides">
          <View style={styles.headRow}>
            <Shimmer style={styles.avatar} />
            <View style={{ flex: 1, gap: 6 }}>
              <Shimmer style={{ width: '55%', height: 13 }} />
              <Shimmer style={{ width: '35%', height: 10 }} />
            </View>
            <Shimmer style={{ width: 52, height: 20 }} />
          </View>
          <Shimmer style={{ width: '85%', height: 11, marginTop: space.md }} />
          <Shimmer style={{ width: '60%', height: 11, marginTop: 8 }} />
          <View style={styles.badgeRow}>
            <Shimmer style={{ width: 54, height: 18, borderRadius: radius.pill }} />
            <Shimmer style={{ width: 40, height: 18, borderRadius: radius.pill }} />
          </View>
          <Shimmer style={{ height: 44, marginTop: space.md, borderRadius: 8 }} />
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: c.surfaceCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.borderSubtle,
    padding: space.lg,
    marginBottom: space.md,
    ...shadowSm,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: space.md },
  bone: { backgroundColor: c.surfaceInset, borderRadius: 6 },
});
