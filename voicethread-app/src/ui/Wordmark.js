// VoiceThread — Wordmark (signature lockup).
// ----------------------------------------------------------------------------
// "VoiceThread" set in the ElevenLabs visual language: Inter Light (300) at
// tight NEGATIVE tracking, pure ink, monochrome — no gradients, no colour, no
// recreating the "11" with letters. An optional motif sits beside or below the
// type: either the "11" mark (two simple vertical bars, clearance = their
// height) or a small audio waveform. Both are decorative tells, kept subtle.
// See docs/ELEVENLABS-BRAND.md → "Wordmark note", "The '11' mark", "Typography".
//
// Pure type + <View> bars (+ the dependency-free <Waveform>), so it bundles in
// Expo Go with no native modules. No business logic — display only.
//
//   import { Wordmark } from './src/ui';
//   <Wordmark />                          // wordmark + "11" bars aside
//   <Wordmark motif="waveform" />         // wordmark + small waveform aside
//   <Wordmark motif="none" size={28} />   // just the type
//   <Wordmark motifPlacement="below" />   // motif under the wordmark

import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, spacing } from '../theme';
import Waveform from './Waveform';

// "11" mark: two simple vertical bars. Brand rule — minimal clearance equals
// their height; never letters/numerals, no shadow/stroke/rotation. Scaled off
// the wordmark's cap height so the lockup stays proportional at any `size`.
function ElevenMark({ size, color }) {
  const barH = Math.round(size * 0.62);
  const barW = Math.max(2, Math.round(size * 0.1));
  const gap = Math.max(2, Math.round(barW * 0.9));
  return (
    <View
      style={[styles.eleven, { columnGap: gap }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={{ width: barW, height: barH, backgroundColor: color }} />
      <View style={{ width: barW, height: barH, backgroundColor: color }} />
    </View>
  );
}

export default function Wordmark({
  size = 34, // display size; pairs with Inter Light + tight tracking
  color = colors.ink,
  motif = 'eleven', // 'eleven' | 'waveform' | 'none'
  motifPlacement = 'aside', // 'aside' | 'below'
  style,
}) {
  // Tighten tracking as the wordmark grows — bigger Light display reads best
  // with a touch more negative letter-spacing (an ElevenLabs tell).
  const letterSpacing = size >= 30 ? -0.6 : size >= 22 ? -0.4 : -0.2;
  const below = motifPlacement === 'below';

  const motifNode =
    motif === 'eleven' ? (
      <ElevenMark size={size} color={color} />
    ) : motif === 'waveform' ? (
      <Waveform
        bars={5}
        height={Math.round(size * 0.6)}
        color={color}
        barWidth={Math.max(2, Math.round(size * 0.08))}
        gap={Math.max(2, Math.round(size * 0.07))}
      />
    ) : null;

  return (
    <View
      style={[below ? styles.colWrap : styles.rowWrap, style]}
      accessibilityRole="header"
      accessibilityLabel="VoiceThread"
    >
      <Text
        style={{
          fontFamily: fontFamily.light,
          fontWeight: '300',
          fontSize: size,
          lineHeight: Math.round(size * 1.1),
          letterSpacing,
          color,
        }}
        // The lockup carries the accessible name; the glyphs themselves needn't
        // be announced twice.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        allowFontScaling
      >
        VoiceThread
      </Text>
      {motifNode}
    </View>
  );
}

const styles = StyleSheet.create({
  // Motif sits to the right of the type, vertically centred on the cap height.
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  // Motif tucks just under the wordmark, left-aligned with it.
  colWrap: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    rowGap: spacing.xs,
  },
  eleven: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
