// ============================================================================
//  Theme token tests — voicethread-app/src/theme.js vs docs/ELEVENLABS-BRAND.md
// ----------------------------------------------------------------------------
//  Locks the design tokens to the brand spec so an accidental edit can't drift
//  the app away from the ElevenLabs visual language. Pure data assertions — no
//  React Native / Expo is loaded (theme.js requires the native font modules
//  lazily inside `useFont`), so this runs under plain `node --test`.
//
//  Source of truth: docs/ELEVENLABS-BRAND.md (Color / Typography / Spacing /
//  Radius / Component-recipe tables). Update BOTH together, on purpose.
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import theme, {
  colors,
  gradientOrbs,
  emotionColors,
  spacing,
  radius,
  type,
  sizes,
  fontFamily,
  useFont,
} from '../voicethread-app/src/theme.js';

// --- Color tokens (LIGHT) --------------------------------------------------
test('colors — LIGHT palette matches the brand spec exactly', () => {
  assert.deepEqual(colors, {
    canvas: '#f5f5f5',
    canvasSoft: '#fafafa',
    surface: '#ffffff',
    surfaceStrong: '#f0efed',
    ink: '#0c0a09',
    primary: '#292524',
    body: '#4e4e4e',
    muted: '#777169',
    mutedSoft: '#a8a29e',
    onPrimary: '#ffffff',
    hairline: '#e7e5e4',
    hairlineSoft: '#f0efed',
    hairlineStrong: '#d6d3d1',
    success: '#16a34a',
    error: '#dc2626',
    overlay: 'rgba(0,0,0,0.4)',
  });
});

// --- Gradient orbs ---------------------------------------------------------
test('gradientOrbs — signature pastel hues match the brand spec', () => {
  assert.deepEqual(gradientOrbs, {
    mint: '#a7e5d3',
    peach: '#f4c5a8',
    lavender: '#c8b8e0',
    sky: '#a8c8e8',
    rose: '#e8b8c4',
  });
});

// --- Emotion colors --------------------------------------------------------
test('emotionColors — covers the classifier emotion set, drawn from on-brand hues', () => {
  // Keys MUST match the classifier (src/features/emotion/classifyEmotion.js)
  // plus the `neutral` fallback the badge uses.
  assert.deepEqual(Object.keys(emotionColors).sort(), [
    'affection',
    'anger',
    'fear',
    'joy',
    'neutral',
    'sadness',
    'surprise',
  ]);
  // Each accent is a pastel orb (brand-honest) except neutral = muted ink.
  const orbValues = new Set(Object.values(gradientOrbs));
  for (const [emotion, hex] of Object.entries(emotionColors)) {
    if (emotion === 'neutral') {
      assert.equal(hex, colors.muted, 'neutral emotion uses muted ink');
    } else {
      assert.ok(orbValues.has(hex), `${emotion} accent is a pastel orb hue`);
    }
  }
});

// --- Spacing (4px base) ----------------------------------------------------
test('spacing — 4px scale matches the brand spec exactly', () => {
  assert.deepEqual(spacing, {
    xxs: 4,
    xs: 8,
    sm: 12,
    base: 16,
    md: 20,
    lg: 24,
    xl: 32,
    xxl: 48,
    section: 64,
  });
  // Sanity: every step is a multiple of 4 (the grid).
  for (const v of Object.values(spacing)) assert.equal(v % 4, 0);
});

// --- Radius ----------------------------------------------------------------
test('radius — scale matches the brand spec exactly', () => {
  assert.deepEqual(radius, {
    xs: 4,
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 24,
    pill: 9999,
  });
});

// --- Typography ------------------------------------------------------------
// Brand spec table: size / weight / line-height (ratio) / letter-spacing / font.
// RN lineHeight is absolute px, so the expected value is size × ratio.
const TYPE_SPEC = {
  displayLg: { fontSize: 34, fontWeight: '300', ratio: 1.1, letterSpacing: -0.6, fontFamily: 'Inter_300Light' },
  displayMd: { fontSize: 28, fontWeight: '300', ratio: 1.13, letterSpacing: -0.4, fontFamily: 'Inter_300Light' },
  displaySm: { fontSize: 22, fontWeight: '300', ratio: 1.2, letterSpacing: -0.2, fontFamily: 'Inter_300Light' },
  titleMd: { fontSize: 20, fontWeight: '500', ratio: 1.35, letterSpacing: 0, fontFamily: 'Inter_500Medium' },
  titleSm: { fontSize: 18, fontWeight: '500', ratio: 1.44, letterSpacing: 0.18, fontFamily: 'Inter_500Medium' },
  body: { fontSize: 16, fontWeight: '400', ratio: 1.5, letterSpacing: 0.16, fontFamily: 'Inter_400Regular' },
  bodyStrong: { fontSize: 16, fontWeight: '500', ratio: 1.5, letterSpacing: 0.16, fontFamily: 'Inter_500Medium' },
  bodySm: { fontSize: 15, fontWeight: '400', ratio: 1.47, letterSpacing: 0.15, fontFamily: 'Inter_400Regular' },
  caption: { fontSize: 14, fontWeight: '400', ratio: 1.5, letterSpacing: 0, fontFamily: 'Inter_400Regular' },
  overline: { fontSize: 12, fontWeight: '600', ratio: 1.4, letterSpacing: 0.96, fontFamily: 'Inter_600SemiBold' },
  button: { fontSize: 15, fontWeight: '500', ratio: 1.0, letterSpacing: 0, fontFamily: 'Inter_500Medium' },
};

test('type — every token matches the brand spec (size / weight / lh / tracking / family)', () => {
  assert.deepEqual(Object.keys(type).sort(), Object.keys(TYPE_SPEC).sort());
  for (const [name, spec] of Object.entries(TYPE_SPEC)) {
    const t = type[name];
    assert.equal(t.fontSize, spec.fontSize, `${name}.fontSize`);
    assert.equal(t.fontWeight, spec.fontWeight, `${name}.fontWeight`);
    assert.equal(t.letterSpacing, spec.letterSpacing, `${name}.letterSpacing`);
    assert.equal(t.fontFamily, spec.fontFamily, `${name}.fontFamily`);
    // lineHeight = size × ratio (allow tiny float error from the multiply).
    const expectedLh = spec.fontSize * spec.ratio;
    assert.ok(
      Math.abs(t.lineHeight - expectedLh) < 0.01,
      `${name}.lineHeight ${t.lineHeight} ≈ ${expectedLh}`,
    );
  }
});

test('type — display tracking is negative, body tracking is positive (the ElevenLabs tell)', () => {
  for (const name of ['displayLg', 'displayMd', 'displaySm']) {
    assert.ok(type[name].letterSpacing < 0, `${name} display tracking is negative`);
    assert.equal(type[name].fontFamily, 'Inter_300Light', `${name} uses Inter Light`);
  }
  for (const name of ['body', 'bodyStrong', 'bodySm']) {
    assert.ok(type[name].letterSpacing > 0, `${name} body tracking is positive`);
  }
  assert.equal(type.overline.textTransform, 'uppercase', 'overline is uppercase');
});

// --- Fonts -----------------------------------------------------------------
test('fontFamily — the four Inter weights the type scale references', () => {
  assert.deepEqual(fontFamily, {
    light: 'Inter_300Light',
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
  });
});

// --- Derived sizes ---------------------------------------------------------
test('sizes — derived dimensions honour the component recipes', () => {
  assert.equal(sizes.tapMin, 44, 'AA minimum touch target');
  // Primary CTA height lands in the brand 48–52 range.
  assert.ok(sizes.ctaHeight >= 48 && sizes.ctaHeight <= 52, 'ctaHeight in 48–52');
  assert.equal(sizes.ctaHeightMin, 48);
  assert.equal(sizes.inputMinHeight, 44, 'input min height (recipe)');
  assert.equal(sizes.inputPadH, 16);
  assert.equal(sizes.inputPadV, 12);
  assert.equal(sizes.voiceIcon, 32, '32px circular voice icon');
  assert.equal(sizes.chipPadH, 10);
  assert.equal(sizes.chipPadV, 4);
  assert.equal(sizes.hairlineWidth, 1, 'hairline borders, not heavy shadows');
  assert.equal(sizes.focusRingWidth, 2, '2px ink focus ring');
});

// --- Importability / composability ----------------------------------------
test('theme — default export bundles every token group and is composable', () => {
  for (const key of ['colors', 'gradientOrbs', 'emotionColors', 'spacing', 'radius', 'type', 'sizes', 'fontFamily', 'useFont']) {
    assert.ok(key in theme, `default export includes ${key}`);
  }
  // Composable: spreading a type token into an RN-style object keeps its props.
  const composed = { color: colors.ink, ...type.body };
  assert.equal(composed.fontSize, 16);
  assert.equal(composed.color, '#0c0a09');
});

test('useFont — is a hook function and is import-safe outside React Native', () => {
  // The function exists and importing this module did not require expo-font /
  // @expo-google-fonts/inter (those are required lazily inside the hook). We do
  // NOT call it here because hooks require a React render context.
  assert.equal(typeof useFont, 'function');
});
