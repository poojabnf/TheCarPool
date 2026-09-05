import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, PanResponder, LayoutChangeEvent,
  ActivityIndicator, StyleProp, ViewStyle,
} from 'react-native';
import { ChevronsRight } from 'lucide-react-native';
import * as haptics from '../services/haptics';
import { c, font, radius } from '../theme/tokens';

/**
 * Slide to confirm.
 *
 * For the small number of actions that end something and cannot be undone --
 * completing a ride releases a rider's fare to the driver, and there is no
 * button afterwards to take it back. A tap is one accidental brush of a thumb
 * against a phone held while driving; a deliberate slide across the width of
 * the screen is not, and it costs a fraction of a second to anyone who meant
 * it.
 *
 * Built on Animated and PanResponder rather than Reanimated, which the project
 * does not carry: adding it would mean a native rebuild, and this needs to
 * ship over the air.
 *
 * Not a general-purpose control. If a tap would do, use Button -- making an
 * ordinary action feel weighty is just friction, and if everything is
 * effortful then nothing reads as serious.
 */

export interface SwipeActionProps {
  /** Instruction shown on the track, e.g. "Slide to complete ride". */
  label: string;
  onComplete: () => void;
  /** Shown instead of the label once the action is running. */
  busyLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  /** Fill behind the thumb as it advances. Defaults to the go colour. */
  tint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TRACK_HEIGHT = 60;
const THUMB_INSET = 4;
const THUMB_SIZE = TRACK_HEIGHT - THUMB_INSET * 2;

/**
 * How far across counts as committed.
 *
 * Not the full width: asking someone to land exactly on the far edge means
 * fighting the spring-back at the end of every honest attempt. At 0.72 the
 * gesture is unmistakably deliberate and still forgiving of a thumb that runs
 * out of screen.
 */
const COMMIT_FRACTION = 0.72;

export default function SwipeAction({
  label, onComplete, busyLabel = 'Working…', loading = false,
  disabled = false, tint = c.go, style, testID,
}: SwipeActionProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const inert = disabled || loading;

  // Latched so the spring-back animation cannot re-fire onComplete, and so a
  // second slide during a slow request cannot submit twice.
  const firedRef = useRef(false);
  const maxTravel = Math.max(0, trackWidth - THUMB_SIZE - THUMB_INSET * 2);

  // JS-driven, not native.
  //
  // The same value positions the thumb AND sizes the fill behind it, and width
  // is a layout property the native driver cannot animate. Driving one node
  // both ways is rejected outright -- the thumb stopped moving and the control
  // looked simply broken. A single drag at 60fps on the JS thread is not the
  // thing worth optimising here.
  const springBack = () => {
    Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4,
      onPanResponderGrant: () => { if (!inert) haptics.tap(); },
      onPanResponderMove: (_e, g) => {
        if (inert || firedRef.current) return;
        // Clamped both ways: the thumb never leaves the track, and dragging
        // backwards must not push it out of the left edge.
        x.setValue(Math.max(0, Math.min(g.dx, maxTravel)));
      },
      onPanResponderRelease: (_e, g) => {
        if (inert || firedRef.current) return springBack();
        if (maxTravel > 0 && g.dx >= maxTravel * COMMIT_FRACTION) {
          firedRef.current = true;
          haptics.success();
          // Settle at the end before firing, so the control visibly finishes
          // the gesture rather than snapping back under a spinner.
          Animated.timing(x, { toValue: maxTravel, duration: 110, useNativeDriver: false })
            .start(() => onComplete());
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: springBack,
    })
  ).current;

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  // The instruction fades as the thumb covers it; the filled tint behind grows
  // with the gesture so progress is legible without a separate indicator.
  const labelOpacity = maxTravel > 0
    ? x.interpolate({ inputRange: [0, maxTravel * 0.6], outputRange: [1, 0], extrapolate: 'clamp' })
    : 1;
  // Interpolated rather than Animated.add with a fresh node per render, which
  // allocated a new value on every frame of the drag.
  const fillWidth = maxTravel > 0
    ? x.interpolate({
        inputRange: [0, maxTravel],
        outputRange: [THUMB_SIZE + THUMB_INSET * 2, trackWidth],
        extrapolate: 'clamp',
      })
    : (THUMB_SIZE + THUMB_INSET * 2);

  return (
    <View
      testID={testID}
      onLayout={onLayout}
      // Handlers on the track, not the knob. A 52pt circle is a small target
      // for a thumb on a phone in a cradle, and a swipe that began anywhere
      // else did nothing at all -- which reads as a broken control rather than
      // a missed target. The gesture is measured as a delta, so grabbing the
      // middle of the track works exactly like grabbing the knob.
      {...pan.panHandlers}
      style={[styles.track, inert && styles.inert, style]}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.fill, { backgroundColor: tint, width: fillWidth }]}
      />
      <Animated.Text
        pointerEvents="none"
        numberOfLines={1}
        style={[styles.label, { opacity: labelOpacity }]}
      >
        {loading ? busyLabel : label}
      </Animated.Text>
      <Animated.View
        pointerEvents="none"
        style={[styles.thumb, { transform: [{ translateX: x }] }]}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint="Swipe right to confirm"
        accessibilityState={{ disabled: inert, busy: loading }}
      >
        {loading
          ? <ActivityIndicator size="small" color={tint} />
          : <ChevronsRight color={tint} size={22} strokeWidth={2.6} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceInset,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    borderRadius: radius.pill,
  },
  label: {
    position: 'absolute',
    left: THUMB_SIZE + 16, right: 16,
    fontFamily: font.sansSemibold,
    fontSize: 15,
    color: c.textSecondary,
  },
  thumb: {
    position: 'absolute',
    left: THUMB_INSET,
    width: THUMB_SIZE, height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: c.bgBase,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#0B0F14',
    shadowOpacity: 0.16, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  inert: { opacity: 0.5 },
});
