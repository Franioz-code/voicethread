// Maps a detected emotion to ElevenLabs synthesis parameters: eleven_v3 audio
// tags + voice_settings + the right model. Store the OUTPUT of this as message
// metadata at receive time, then ALWAYS read it back at playback — so a message
// sounds identical every time it's played ("accurate replay").
//
//   emotionToSynthesis({emotion, intensity}) -> { tags, modelId, voiceSettings }
//   applyTags(text, tags)                     -> "[happy] original text"

const BASE = { stability: 0.5, similarity_boost: 0.8, style: 0, use_speaker_boost: true };

// per-emotion: a normal tag, a stronger tag for high intensity, and deltas
// applied to voice_settings (lower stability + higher style = more expressive).
const MAP = {
  joy:       { tag: '[happy]',     strong: '[excited]',   dStability: -0.15, dStyle: 0.35 },
  sadness:   { tag: '[sad]',       strong: '[sad]',       dStability: 0.20,  dStyle: 0.10 },
  anger:     { tag: '[angry]',     strong: '[angry]',     dStability: -0.20, dStyle: 0.40 },
  fear:      { tag: '[nervous]',   strong: '[scared]',    dStability: -0.10, dStyle: 0.20 },
  affection: { tag: '[warm]',      strong: '[warm]',      dStability: 0.05,  dStyle: 0.20 },
  surprise:  { tag: '[surprised]', strong: '[surprised]', dStability: -0.10, dStyle: 0.25 },
};

const clamp01 = (n) => Math.max(0, Math.min(1, Math.round(n * 100) / 100));

export function emotionToSynthesis({ emotion = 'neutral', intensity = 0 } = {}, opts = {}) {
  const models = opts.models || { emotion: 'eleven_v3', fallback: 'eleven_multilingual_v2' };

  // Neutral -> no tags, use the reliable multilingual model.
  if (emotion === 'neutral' || !MAP[emotion]) {
    return { tags: [], modelId: models.fallback, voiceSettings: { ...BASE } };
  }

  const m = MAP[emotion];
  const tag = intensity >= 0.5 ? m.strong : m.tag;
  const scale = 0.5 + intensity / 2; // 0.5..1 — stronger emotion = bigger shift
  return {
    tags: [tag],
    modelId: models.emotion, // tags only work on eleven_v3
    voiceSettings: {
      ...BASE,
      stability: clamp01(BASE.stability + m.dStability * scale),
      style: clamp01(BASE.style + m.dStyle * scale),
    },
  };
}

export function applyTags(text, tags) {
  if (!tags || !tags.length) return text;
  return `${tags.join(' ')} ${text}`;
}
