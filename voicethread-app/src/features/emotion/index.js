// On-device emotion module — public surface.
//
//   import { analyzeForSpeech } from '.../features/emotion';
//   const meta = analyzeForSpeech("Hahaha super!! 😂");
//   // meta = { emotion, intensity, confidence, tags, modelId, voiceSettings, ttsText }
//   // Persist `meta` with the message, then send meta.ttsText + voiceId +
//   // meta.modelId + meta.voiceSettings to POST /api/tts.

export { classifyEmotion } from './classifyEmotion.js';
export { emotionToSynthesis, applyTags } from './emotionToSynthesis.js';

import { classifyEmotion } from './classifyEmotion.js';
import { emotionToSynthesis, applyTags } from './emotionToSynthesis.js';

/** One-call helper: text -> everything needed to synthesize it with emotion. */
export function analyzeForSpeech(text, opts = {}) {
  const { emotion, intensity, confidence } = classifyEmotion(text);
  const { tags, modelId, voiceSettings } = emotionToSynthesis({ emotion, intensity }, opts);
  return {
    emotion,
    intensity,
    confidence,
    tags,
    modelId,
    voiceSettings,
    ttsText: applyTags(text, tags), // text with audio tags prepended (for eleven_v3)
  };
}
