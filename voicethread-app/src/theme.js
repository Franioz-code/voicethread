// VoiceThread — design system (single source of truth for the app's look).
//
// Re-skinned to the ElevenLabs visual language (see docs/ELEVENLABS-BRAND.md):
// monochrome warm-stone neutrals, ink CTAs, hairline borders, generous canvas,
// pastel gradient orbs as atmosphere only, and Inter type with a light/tight
// display + slightly-positive body tracking.
//
// Everything below the `useFont` hook is PURE data (no React-Native / Expo
// imports) so the tokens are importable and testable in any JS runtime. Font
// loading is the only side-effecting piece and it lazily/​safely requires the
// native modules, so importing this file never crashes outside the app.
//
//   import { colors, gradientOrbs, spacing, radius, type, sizes } from './src/theme';
//   import { useFont, fontFamily } from './src/theme';

// --- Palette (LIGHT — default) --------------------------------------------
// Monochrome-first warm "stone" neutral scale. No saturated UI colors; the
// primary CTA is ink, never a bright hue. Foreground tokens meet AA contrast
// against `canvas`/`surface`. See ELEVENLABS-BRAND.md → "Color tokens (LIGHT)".
export const colors = {
  // Surfaces (back-to-front).
  canvas: '#f5f5f5', // app background
  canvasSoft: '#fafafa', // secondary background
  surface: '#ffffff', // cards, inputs, bubbles
  surfaceStrong: '#f0efed', // chips, badges, voice-icon bg

  // Text / ink ramp.
  ink: '#0c0a09', // strongest text, primary-active (pressed CTA)
  primary: '#292524', // primary CTA fill, body-strong text
  body: '#4e4e4e', // body text
  muted: '#777169', // secondary text
  mutedSoft: '#a8a29e', // tertiary / placeholder
  onPrimary: '#ffffff', // text on ink / primary

  // Hairlines.
  hairline: '#e7e5e4', // borders / dividers
  hairlineSoft: '#f0efed', // subtle dividers
  hairlineStrong: '#d6d3d1', // input borders, outline buttons

  // Status (used sparingly — never as CTA colors).
  success: '#16a34a', // success only
  error: '#dc2626', // error only

  // Misc.
  overlay: 'rgba(0,0,0,0.4)', // scrims behind modals/sheets
};

// --- Palette (DARK — for a later flip) ------------------------------------
// Not wired into the app yet; kept here so a future theme swap is a data change
// rather than a rewrite. See ELEVENLABS-BRAND.md → "Color tokens (DARK)".
export const colorsDark = {
  canvas: '#0c0a09',
  canvasSoft: '#0c0a09',
  surface: '#1c1917',
  surfaceStrong: '#292524',
  ink: '#ffffff', // ink-on-light inverts to light-on-dark
  primary: '#ffffff',
  body: '#d6d3d1',
  muted: '#a8a29e',
  mutedSoft: '#777169',
  onPrimary: '#0c0a09',
  hairline: '#292524',
  hairlineSoft: '#1c1917',
  hairlineStrong: '#3a3531',
  success: '#16a34a',
  error: '#dc2626',
  overlay: 'rgba(0,0,0,0.6)',
};

// --- Gradient orbs (signature, decorative only) ---------------------------
// Pastel blooms used ONLY as soft atmosphere behind the wordmark / hero or
// inside a 24px-radius "orb card". NEVER as button fills, text, or card
// backgrounds. See ELEVENLABS-BRAND.md → "Gradient orbs".
export const gradientOrbs = {
  mint: '#a7e5d3',
  peach: '#f4c5a8',
  lavender: '#c8b8e0',
  sky: '#a8c8e8',
  rose: '#e8b8c4',
};

// --- Per-emotion accents ---------------------------------------------------
// The emotion badge in "Mów" reads the detected feeling at a glance. To stay
// brand-honest (monochrome-first, no saturated UI palette) these are mapped
// onto the pastel-orb hues — soft, decorative, on-brand — rather than the loud
// primaries used before. `neutral` falls back to muted ink. Keys MUST match the
// classifier's emotion set (joy/sadness/anger/fear/affection/surprise/neutral).
export const emotionColors = {
  joy: gradientOrbs.peach,
  sadness: gradientOrbs.sky,
  anger: gradientOrbs.rose,
  fear: gradientOrbs.lavender,
  affection: gradientOrbs.rose,
  surprise: gradientOrbs.mint,
  neutral: colors.muted,
};

// --- Spacing (4px base) ----------------------------------------------------
// See ELEVENLABS-BRAND.md → "Spacing". Use these instead of magic numbers.
export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  base: 16,
  md: 20,
  lg: 24,
  xl: 32,
  xxl: 48,
  section: 64,
};

// --- Radius ----------------------------------------------------------------
// See ELEVENLABS-BRAND.md → "Radius".
export const radius = {
  xs: 4,
  sm: 6,
  md: 8, // inputs
  lg: 12,
  xl: 16, // cards
  xxl: 24, // orb cards
  pill: 9999, // CTAs, badges, voice icons, avatars
};

// --- Fonts -----------------------------------------------------------------
// Inter, loaded via @expo-google-fonts/inter + expo-font (see `useFont`). These
// family names match the keys passed to useFonts(); the `type` scale references
// them by `fontFamily`. Until the fonts finish loading, components still render
// using the platform system font (RN falls back automatically for an unknown
// family), so first paint is never blocked.
export const fontFamily = {
  light: 'Inter_300Light',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
};

// --- Typography (Inter) ----------------------------------------------------
// Display = Inter Light (300) at NEGATIVE tracking; body = regular with a
// slightly POSITIVE tracking. That contrast is a key ElevenLabs tell. Line
// heights are pre-computed (size × ratio) because React Native's `lineHeight`
// is an absolute pixel value, not a multiplier. `fontWeight` is kept alongside
// `fontFamily` so weight still reads correctly before fonts load / if a family
// is missing. See ELEVENLABS-BRAND.md → "Typography".
export const type = {
  // size, weight, lh ratio, tracking, family — from the brand spec table.
  displayLg: {
    fontFamily: fontFamily.light,
    fontSize: 34,
    fontWeight: '300',
    lineHeight: 37.4, // 34 × 1.1
    letterSpacing: -0.6,
  },
  displayMd: {
    fontFamily: fontFamily.light,
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 31.64, // 28 × 1.13
    letterSpacing: -0.4,
  },
  displaySm: {
    fontFamily: fontFamily.light,
    fontSize: 22,
    fontWeight: '300',
    lineHeight: 26.4, // 22 × 1.2
    letterSpacing: -0.2,
  },
  titleMd: {
    fontFamily: fontFamily.medium,
    fontSize: 20,
    fontWeight: '500',
    lineHeight: 27, // 20 × 1.35
    letterSpacing: 0,
  },
  titleSm: {
    fontFamily: fontFamily.medium,
    fontSize: 18,
    fontWeight: '500',
    lineHeight: 25.92, // 18 × 1.44
    letterSpacing: 0.18,
  },
  body: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24, // 16 × 1.5
    letterSpacing: 0.16,
  },
  bodyStrong: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24, // 16 × 1.5
    letterSpacing: 0.16,
  },
  bodySm: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22.05, // 15 × 1.47
    letterSpacing: 0.15,
  },
  caption: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 21, // 14 × 1.5
    letterSpacing: 0,
  },
  overline: {
    fontFamily: fontFamily.semibold,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16.8, // 12 × 1.4
    letterSpacing: 0.96,
    textTransform: 'uppercase',
  },
  button: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 15, // 15 × 1.0
    letterSpacing: 0,
  },
};

// --- Elevation -------------------------------------------------------------
// Mostly flat — rely on hairlines, not shadows. A single very-soft shadow for
// genuinely raised surfaces. See ELEVENLABS-BRAND.md → "Elevation". Spread as
// `...elevation.raised` onto a RN style (iOS shadow* + Android elevation).
export const elevation = {
  flat: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  raised: {
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};

// --- Derived sizes ---------------------------------------------------------
// One place to keep tap targets honest and component dimensions on-spec.
// See ELEVENLABS-BRAND.md → "Component recipes".
export const sizes = {
  tapMin: 44, // platform-minimum accessible touch target
  ctaHeight: 52, // primary pill CTA (brand: 48–52, mobile-comfortable)
  ctaHeightMin: 48,
  inputMinHeight: 44, // single-line input min height
  inputPadH: 16, // input horizontal padding (12×16 recipe)
  inputPadV: 12, // input vertical padding
  voiceIcon: 32, // circular voice-row icon
  chipPadH: 10, // badge / chip pill padding (4×10)
  chipPadV: 4,
  hairlineWidth: 1, // hairline border weight
  focusRingWidth: 2, // focused input outline weight
  headerTopPad: 60, // clears the status bar / notch
  hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
};

// --- Font loading hook -----------------------------------------------------
// Loads the four Inter weights used by the type scale. Returns `true` once the
// fonts are ready (or if loading errored — we degrade gracefully to the system
// font rather than hanging the splash).
//
// The Expo/RN modules are required LAZILY inside the hook so that importing this
// file in a plain JS runtime (e.g. `node --test` for the token tests) never
// touches native code. If the font packages are unavailable for any reason the
// hook still resolves `true` so the app renders with system fonts.
//
//   const fontsReady = useFont();
//   if (!fontsReady) return <SplashScreen />;   // or render anyway — your call
export function useFont() {
  // `require` (not static import) keeps these out of the module's import graph
  // for non-RN consumers. expo-font's useFonts already returns [loaded, error].
  try {
    // eslint-disable-next-line global-require
    const { useFonts } = require('expo-font');
    const {
      // eslint-disable-next-line global-require
      Inter_300Light,
      Inter_400Regular,
      Inter_500Medium,
      Inter_600SemiBold,
    } = require('@expo-google-fonts/inter');

    const [loaded, error] = useFonts({
      Inter_300Light,
      Inter_400Regular,
      Inter_500Medium,
      Inter_600SemiBold,
    });

    // Treat an error as "ready" — fall back to system font instead of blocking.
    return loaded || Boolean(error);
  } catch (e) {
    // Font packages not present / not in a RN runtime: don't block rendering.
    return true;
  }
}

export default {
  colors,
  colorsDark,
  gradientOrbs,
  emotionColors,
  spacing,
  radius,
  fontFamily,
  type,
  elevation,
  sizes,
  useFont,
};
