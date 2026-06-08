// On-device emotion classifier — pure, deterministic, offline, multilingual.
// No network: only the resulting text/metadata is ever sent for synthesis,
// which is what keeps the "emotions computed on-device" privacy promise.
//
//   classifyEmotion(text) -> { emotion, intensity (0..1), confidence (0..1) }
//
// Signals: emoji, keyword lexicons (all languages at once), exclamation/question
// marks, ALL-CAPS shouting, letter elongation ("noooo") and laughter ("haha").

import { LEXICONS } from './lexicons.js';

const EMOTIONS = ['joy', 'sadness', 'anger', 'fear', 'affection', 'surprise'];

// emoji -> [emotion, weight]
const EMOJI = {
  '😂': ['joy', 2], '🤣': ['joy', 2], '😁': ['joy', 1.5], '😄': ['joy', 1.5], '😊': ['joy', 1], '😅': ['joy', 1], '🔥': ['joy', 1],
  '😍': ['affection', 2], '🥰': ['affection', 2], '❤️': ['affection', 2], '❤': ['affection', 2], '😘': ['affection', 1.5], '💕': ['affection', 1.5],
  '😢': ['sadness', 2], '😭': ['sadness', 2], '😞': ['sadness', 1.5], '😔': ['sadness', 1.5], '🥺': ['sadness', 1.5],
  '😡': ['anger', 2], '🤬': ['anger', 2], '😠': ['anger', 1.5],
  '😱': ['fear', 2], '😨': ['fear', 1.5], '😰': ['fear', 1.5],
  '😮': ['surprise', 1.5], '😲': ['surprise', 2], '🤯': ['surprise', 2],
};

const round2 = (n) => Math.round(n * 100) / 100;

export function classifyEmotion(text) {
  if (!text || typeof text !== 'string') return { emotion: 'neutral', intensity: 0, confidence: 0 };

  const scores = Object.fromEntries(EMOTIONS.map((e) => [e, 0]));
  const lower = text.toLowerCase();

  // 1) emoji
  for (const [ch, [emo, w]] of Object.entries(EMOJI)) {
    if (text.includes(ch)) {
      const count = text.split(ch).length - 1;
      scores[emo] += w * count;
    }
  }

  // 2) keyword lexicons — scan EVERY language (handles mixed-language text)
  for (const lex of Object.values(LEXICONS)) {
    for (const [emo, words] of Object.entries(lex)) {
      if (scores[emo] === undefined) continue;
      for (const w of words) if (lower.includes(w)) scores[emo] += 1;
    }
  }

  // 3) laughter
  if (/\b(ha(ha)+|he(he)+|xd+|lol)\b/i.test(lower)) scores.joy += 2;

  // intensity signals
  const exclaims = (text.match(/!/g) || []).length;
  const questions = (text.match(/\?/g) || []).length;
  const ellipsis = /\.\.\.|…/.test(text);
  const capsWords = (text.match(/\b[A-ZĄĆĘŁŃÓŚŹŻ]{3,}\b/g) || []).length;
  const elongated = /(\p{L})\1{2,}/u.test(text); // "noooo", "takkk"

  // argmax
  let emotion = 'neutral', top = 0, second = 0;
  for (const emo of EMOTIONS) {
    const s = scores[emo];
    if (s > top) { second = top; top = s; emotion = emo; }
    else if (s > second) second = s;
  }
  if (top === 0) {
    emotion = 'neutral';
    // "?!" with no lexical signal reads as surprise
    if (questions > 0 && exclaims > 0) emotion = 'surprise';
  }

  // intensity 0..1
  let intensity = 0;
  intensity += Math.min(exclaims, 3) * 0.18;
  intensity += Math.min(capsWords, 2) * 0.2;
  intensity += elongated ? 0.2 : 0;
  intensity += ellipsis && emotion === 'sadness' ? 0.15 : 0;
  intensity += Math.min(top, 4) * 0.12;
  if (emotion === 'neutral') intensity = Math.min(intensity, 0.2);
  intensity = Math.max(0, Math.min(1, intensity));

  const confidence = top === 0 ? 0.2 : Math.min(1, (top - second) / (top + 1) + 0.3);
  return { emotion, intensity: round2(intensity), confidence: round2(confidence) };
}
