// VoiceThread — GradientOrb (signature pastel bloom).
// ----------------------------------------------------------------------------
// The ElevenLabs "gradient orb": a soft pastel radial bloom used ONLY as quiet
// atmosphere behind a hero / header / wordmark — never as a button fill, text,
// or card background. One orb = one pastel hue from the `gradientOrbs` token,
// rendered at a low opacity (~0.08 default) so it reads as light, not colour.
// See docs/ELEVENLABS-BRAND.md → "Gradient orbs (signature, decorative only)".
//
// We approximate a radial blur without a gradient/SVG/blur native module (none
// are installed) by stacking a few concentric translucent circles: large+faint
// at the edge fading to a slightly stronger core. At these opacities the rings
// blend into a believable soft bloom, and it always bundles in Expo Go.
//
// Decorative by contract: it renders nothing interactive, is pointer-transparent
// so it never eats touches on the content above it, and is hidden from the
// accessibility tree.
//
//   import { GradientOrb } from './src/ui';
//   // Place absolutely behind a hero, then your content on top:
//   <GradientOrb color={gradientOrbs.lavender} size={320} style={{ top: -80, left: -40 }} />

import { StyleSheet, View } from 'react-native';
import { gradientOrbs } from '../theme';

// Concentric rings as fractions of the orb size, from outer (faint) to inner
// (strongest). Each ring's opacity is `opacity * weight`, so the whole bloom
// scales with a single `opacity` prop while keeping its radial falloff.
const RINGS = [
  { scale: 1.0, weight: 0.45 },
  { scale: 0.74, weight: 0.7 },
  { scale: 0.5, weight: 0.9 },
  { scale: 0.28, weight: 1.0 },
];

export default function GradientOrb({
  color = gradientOrbs.lavender,
  size = 280,
  opacity = 0.08,
  style,
}) {
  return (
    <View
      pointerEvents="none" // atmosphere must never intercept touches
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    >
      {RINGS.map((ring) => {
        const d = size * ring.scale;
        return (
          <View
            key={`ring-${ring.scale}`}
            style={{
              position: 'absolute',
              width: d,
              height: d,
              borderRadius: d / 2,
              backgroundColor: color,
              opacity: opacity * ring.weight,
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    // Caller positions it (usually position:'absolute' + offsets) via `style`.
  },
});
