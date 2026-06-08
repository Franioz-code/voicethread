// VoiceThread — Waveform (signature audio motif).
// ----------------------------------------------------------------------------
// The product's visual signature: a simple, crisp audio waveform of 4–8 ink
// bars with rounded caps. ElevenLabs uses the waveform as a quiet brand tell,
// so this stays MONOCHROME (ink by default) and decorative — no business logic,
// no audio data in; you give it a height + bar count and it draws a calm,
// symmetric "voiceprint". See docs/ELEVENLABS-BRAND.md → "Audio motif".
//
// Two modes:
//   • static  (default) — a fixed, gently-arched bar pattern. Zero timers, safe
//                         to render anywhere (headers, rows, empty states).
//   • animated          — bars breathe with a subtle, looping ease. Use behind
//                         a "speaking"/"listening" affordance. Honors reduce-
//                         motion and cleans up its loop on unmount.
//
// Implemented with plain React Native <View>s (no react-native-svg dependency)
// so it always bundles in Expo Go. Bars are vector-crisp rounded rectangles —
// visually identical to an SVG <rect rx>, but dependency-free.
//
//   import { Waveform } from './src/ui';
//   <Waveform />                              // static, default ink bars
//   <Waveform animated height={20} />         // breathing
//   <Waveform bars={5} color={colors.muted} />

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors, radius } from '../theme';

// A fixed, pleasing envelope (relative bar heights, 0..1) — taller in the
// middle like a spoken syllable. We sample `bars` points from it so any count
// from 4–8 stays balanced and symmetric.
const ENVELOPE = [0.42, 0.7, 0.95, 1, 0.78, 0.95, 0.6, 0.4];

// Clamp the requested bar count into the on-brand 4–8 range.
function clampBars(n) {
  const v = Math.round(Number(n) || 0);
  return Math.max(4, Math.min(8, v));
}

// Sample `count` relative heights from ENVELOPE, keeping the arch symmetric.
function sampleHeights(count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    // Map i -> ENVELOPE index across the full envelope width.
    const t = count === 1 ? 0 : i / (count - 1);
    const idx = Math.round(t * (ENVELOPE.length - 1));
    out.push(ENVELOPE[idx]);
  }
  return out;
}

export default function Waveform({
  bars = 6,
  height = 16,
  barWidth = 3,
  gap = 3,
  color = colors.ink,
  animated = false,
  // Shortest bar as a fraction of `height` — keeps small bars visible.
  minScale = 0.32,
  style,
  accessibilityLabel,
}) {
  const count = clampBars(bars);
  const heights = useMemo(() => sampleHeights(count), [count]);

  // One Animated.Value per bar, started lazily only when `animated`.
  const values = useRef([]);
  if (values.current.length !== count) {
    values.current = heights.map(
      (h, i) => values.current[i] || new Animated.Value(h),
    );
  }

  useEffect(() => {
    if (!animated) return undefined;

    // Each bar runs an offset, looping ease between its resting height and a
    // slightly taller peak — a calm "breathing" voiceprint, never frenetic.
    const loops = values.current.map((val, i) => {
      const rest = Math.max(minScale, heights[i]);
      const peak = Math.min(1, rest + 0.18);
      const dur = 620 + i * 90; // stagger so bars don't pulse in lockstep
      return Animated.loop(
        Animated.sequence([
          Animated.timing(val, {
            toValue: peak,
            duration: dur,
            delay: i * 70,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false, // animating layout height, not transform
          }),
          Animated.timing(val, {
            toValue: rest,
            duration: dur,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
      );
    });
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [animated, count, height, minScale]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View
      style={[styles.row, { height, columnGap: gap }, style]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? 'Fala dźwiękowa'}
      // Purely decorative when unlabeled — keep it out of the a11y tree noise.
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    >
      {heights.map((h, i) => {
        const key = `bar-${i}`;
        const base = {
          width: barWidth,
          borderRadius: radius.pill,
          backgroundColor: color,
        };
        if (animated) {
          // Interpolate the 0..1 scale into an absolute pixel height so caps
          // stay rounded and the bar grows from the vertical centre.
          const h2 = values.current[i].interpolate({
            inputRange: [0, 1],
            outputRange: [Math.max(2, height * minScale), height],
          });
          return <Animated.View key={key} style={[base, { height: h2 }]} />;
        }
        const px = Math.max(2, Math.round(height * Math.max(minScale, h)));
        return <View key={key} style={[base, { height: px }]} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center', // bars grow symmetrically from the vertical centre
    justifyContent: 'center',
  },
});
