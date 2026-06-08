// VoiceThread — brand UI components (signature motifs).
// ----------------------------------------------------------------------------
// Re-usable, behaviour-free building blocks that carry the ElevenLabs visual
// language into the app. All monochrome / token-driven, all dependency-free
// (plain React Native — no react-native-svg / gradient / blur native modules),
// so they always bundle in Expo Go. See docs/ELEVENLABS-BRAND.md.
//
//   import { Wordmark, GradientOrb, Waveform } from './src/ui';
//
//   • Wordmark   — "VoiceThread" in Inter Light + tight tracking, ink, with an
//                  optional "11" bars or waveform motif.
//   • GradientOrb— soft pastel radial bloom (atmosphere only, ~0.08 opacity).
//   • Waveform   — 4–8 ink bars, static or gently breathing (the audio motif).

export { default as Wordmark } from './Wordmark';
export { default as GradientOrb } from './GradientOrb';
export { default as Waveform } from './Waveform';
