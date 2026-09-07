import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, PanResponder, LayoutChangeEvent,
  ActivityIndicator, Dimensions, StyleProp, ViewStyle,
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
const COMMIT_FRACTION = 0.55;

/**
 * A confident flick counts even when it stops short.
 *
 * At 0.72 of the track and distance alone, a deliberate swipe that ran out of
 * thumb at two thirds sprang back, and the driver tried again -- reported as
 * "works, but takes a few goes". Distance OR speed commits now: someone who
 * throws the knob is as certain as someone who walks it to the end, and the
 * accidental brush this control exists to prevent has neither.
 */
const FLICK_VELOCITY = 0.6;
const FLICK_MIN_FRACTION = 0.3;

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
  const armedRef = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current); }, []);
  /**
   * How far the thumb can travel.
   *
   * Falls back to the screen width when onLayout has not reported one.
   * Measurement is the single point this control depends on, and when it
   * returned 0 the slider became silently inert -- haptic on touch, nothing
   * else. A control that governs finishing a ride should not be one layout
   * quirk away from unusable, so an approximate width that works beats an
   * exact one that might never arrive. The real measurement replaces it the
   * moment it lands.
   */
  const FALLBACK_WIDTH = Dimensions.get('window').width - 32;
  const effectiveWidth = trackWidth > 0 ? trackWidth : FALLBACK_WIDTH;
  const maxTravel = Math.max(0, effectiveWidth - THUMB_SIZE - THUMB_INSET * 2);

  /**
   * Live copies of everything the gesture handlers need.
   *
   * PanResponder.create runs once, inside a ref, so its handlers close over
   * the values from the FIRST render -- when the track had not been measured
   * and maxTravel was still 0. Every later frame clamped the thumb to
   * Math.min(dx, 0) and every release failed the `maxTravel > 0` test, so the
   * control fired its haptic on touch and then did nothing at all: it felt
   * alive and was inert. Reading through refs keeps the handlers current
   * without rebuilding the responder mid-gesture, which would drop the touch.
   */
  const maxTravelRef = useRef(maxTravel);
  const inertRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  maxTravelRef.current = maxTravel;
  inertRef.current = disabled || loading;
  onCompleteRef.current = onComplete;

  // JS-driven, not native.
  //
  // The same value positions the thumb AND sizes the fill behind it, and width
  // is a layout property the native driver cannot animate. Driving one node
  // both ways is rejected outright -- the thumb stopped moving and the control
  // looked simply broken. A single drag at 60fps on the JS thread is not the
  // thing worth optimising here.
  const springBack = () => {
    armedRef.current = false;
    Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4,
      // Never hand the gesture back once it is ours.
      //
      // The card sits in a scrolling list, and a drag with any vertical
      // component let the ScrollView ask for the responder and take it
      // mid-swipe. The thumb stopped dead and the ride did not complete --
      // intermittently, depending on how straight the thumb travelled, which
      // is exactly how "works sometimes" is produced.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { if (!inertRef.current) haptics.tap(); },
      onPanResponderMove: (_e, g) => {
        if (inertRef.current || firedRef.current) return;
        // Clamped both ways: the thumb never leaves the track, and dragging
        // backwards must not push it out of the left edge.
        const travel = maxTravelRef.current;
        x.setValue(Math.max(0, Math.min(g.dx, travel)));
        // One tick as the thumb crosses the point of no return. Without it the
        // only way to know the swipe had gone far enough was to let go and
        // find out, which is why a short swipe felt like a broken control
        // rather than an incomplete one.
        const past = travel > 0 && g.dx >= travel * COMMIT_FRACTION;
        if (past !== armedRef.current) {
          armedRef.current = past;
          if (past) haptics.tap();
        }
      },
      onPanResponderRelease: (_e, g) => {
        if (inertRef.current || firedRef.current) return springBack();
        const travel = maxTravelRef.current;
        const far = g.dx >= travel * COMMIT_FRACTION;
        const flicked = g.vx >= FLICK_VELOCITY && g.dx >= travel * FLICK_MIN_FRACTION;
        if (travel > 0 && (far || flicked)) {
          firedRef.current = true;
          haptics.success();
          // Settle at the end before firing, so the control visibly finishes
          // the gesture rather than snapping back under a spinner.
          Animated.timing(x, { toValue: travel, duration: 110, useNativeDriver: false })
            .start(() => {
              onCompleteRef.current();
              // Unlatch after a moment. The latch is there to stop a double
              // submit, not to retire the control: when the request behind it
              // fails, the card stays on screen and a permanently dead slider
              // leaves the driver with no way to finish their ride. On success
              // the card unmounts long before this runs.
              retryTimer.current = setTimeout(() => {
                firedRef.current = false;
                x.setValue(0);
              }, 3000);
            });
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: springBack,
    })
  ).current;

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  /**
   * A slow nudge on the chevron while the control sits untouched.
   *
   * A pill with a round knob reads as a button, and a driver who taps it and
   * sees nothing happen concludes it is broken -- which is exactly the report
   * that came back. Movement is the only thing that says "drag me" without
   * adding a line of text nobody reads.
   *
   * Its own value, deliberately: sharing the drag's would mean an idle
   * animation fighting the gesture for the same node. Stops while the user is
   * actually dragging, because by then it has done its job.
   */
  const hint = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (inert) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hint, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(hint, { toValue: 0, duration: 700, useNativeDriver: true }),
        Animated.delay(900),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [inert, hint]);

  const hintShift = hint.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });

  // The instruction fades as the thumb covers it; the filled tint behind grows
  // with the gesture so progress is legible without a separate indicator.
  const labelOpacity = maxTravel > 0
    ? x.interpolate({ inputRange: [0, maxTravel * 0.45], outputRange: [1, 0], extrapolate: 'clamp' })
    : 1;
  // Interpolated rather than Animated.add with a fresh node per render, which
  // allocated a new value on every frame of the drag.
  /**
   * The label gives way, and the knob brightens, once the swipe is far enough
   * to land. Paired with the haptic tick: one cue for the hand, one for the
   * eye, so nobody has to let go to discover whether they went far enough.
   */
  const armedTint = maxTravel > 0
    ? x.interpolate({
        inputRange: [0, maxTravel * COMMIT_FRACTION, maxTravel],
        outputRange: [c.bgBase, c.bgBase, c.goSoft],
        extrapolate: 'clamp',
      })
    : c.bgBase;

  const fillWidth = maxTravel > 0
    ? x.interpolate({
        inputRange: [0, maxTravel],
        outputRange: [THUMB_SIZE + THUMB_INSET * 2, effectiveWidth],
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
        style={[styles.thumb, { backgroundColor: armedTint, transform: [{ translateX: x }] }]}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint="Swipe right to confirm"
        accessibilityState={{ disabled: inert, busy: loading }}
      >
        {loading
          ? <ActivityIndicator size="small" color={tint} />
          : (
            <Animated.View style={{ transform: [{ translateX: hintShift }] }}>
              <ChevronsRight color={tint} size={22} strokeWidth={2.6} />
            </Animated.View>
          )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    // Tinted, not neutral grey.
    //
    // On the inset surface this read as a disabled field rather than the one
    // action left on a running trip -- a driver looking for "complete" did not
    // see a control at all. The wash and the outline are the same green the
    // fill uses, so the resting state announces what the gesture will do.
    backgroundColor: c.goSoft,
    borderWidth: 1.5,
    borderColor: c.go,
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
    // Bold and in the action's own colour: secondary grey on a tinted track
    // is the weight given to a caption, not to an instruction.
    fontFamily: font.sansBold,
    fontSize: 15.5,
    color: c.goStrong,
    letterSpacing: 0.1,
  },
  thumb: {
    position: 'absolute',
    left: THUMB_INSET,
    width: THUMB_SIZE, height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: c.bgBase,
    alignItems: 'center', justifyContent: 'center',
    // A lifted knob against the tint, so the thing you are meant to grab is
    // the most solid object in the control.
    shadowColor: '#0B0F14',
    shadowOpacity: 0.22, shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  inert: { opacity: 0.5 },
});
