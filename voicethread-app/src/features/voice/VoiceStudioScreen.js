// VoiceThread — VoiceStudioScreen ("Mój głos").
// ----------------------------------------------------------------------------
// The signature personalization: clone YOUR voice from a short sample so peers
// hear your messages in your real voice (ElevenLabs Instant Voice Cloning via
// the backend /api/voices/add). On a free plan the backend returns a friendly
// 402 ("wymaga płatnego planu") which we show as guidance — the PoC degrades
// gracefully to premade voices (chosen when starting a chat).
//
// App.js wraps this body with its SubHeader (title + back), so this renders the
// content only. ElevenLabs visual language: canvas, ink pill CTAs, hairlines.

import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { createAudioPlayer } from 'expo-audio';
import { colors, gradientOrbs, radius, sizes, spacing, type } from '../../theme';
import * as relay from '../../api/socket';
import * as repo from '../../db/repo';
import { useVoiceClone } from './useVoiceClone';

// A short script that gives the cloner enough varied phonemes (~30–45s read).
const SCRIPT =
  'Cześć! Nazywam się tak, jak wiesz, i to jest mój prawdziwy głos. ' +
  'Lubię, kiedy wiadomości brzmią naturalnie — z emocjami, śmiechem i spokojem. ' +
  'Czasem mówię szybko, gdy jestem podekscytowany, a czasem wolno i ciepło. ' +
  'Dziękuję, że słuchasz — do usłyszenia w rozmowie!';

// Tips shown in the studio so the user records a clean, clone-worthy sample.
const TIPS = [
  'Nagrywaj w cichym miejscu — bez muzyki, TV ani innych głosów w tle.',
  'Trzymaj telefon ~20 cm od ust; mów wyraźnie i naturalnie.',
  '40–60 sekund ciągłej mowy — im więcej czystego audio, tym wierniejszy klon.',
  'Tylko Twój głos — klonujemy jednego mówcę.',
];

function fmtDur(ms) {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function VoiceStudioScreen({ profile, onSaved }) {
  const clone = useVoiceClone();
  const [result, setResult] = useState(null); // { voiceId, name } on success
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef(null);

  const voiceName = `${profile?.displayName ? profile.displayName : 'Mój'} głos`;
  const alreadyCloned = !!profile?.defaultVoiceId && String(profile.defaultVoiceId).length > 20;

  async function onClone() {
    const data = await clone.clone(voiceName);
    if (data?.voiceId) {
      try { await repo.updateProfile({ defaultVoiceId: data.voiceId }); } catch { /* ignore */ }
      setResult(data);
      onSaved?.(data.voiceId);
    }
  }

  function preview(voiceId) {
    try { playerRef.current?.remove(); } catch { /* ignore */ }
    try {
      const text = 'Cześć! Tak teraz brzmią moje wiadomości — moim własnym głosem.';
      const url = `${relay.BACKEND_URL}/api/tts?text=${encodeURIComponent(text)}&voiceId=${encodeURIComponent(voiceId)}&modelId=eleven_multilingual_v2`;
      const p = createAudioPlayer(url);
      playerRef.current = p;
      setPlaying(true);
      p.play();
      setTimeout(() => setPlaying(false), 6000);
    } catch { setPlaying(false); }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* soft brand bloom behind the intro */}
      <View pointerEvents="none" style={[styles.orb, { backgroundColor: gradientOrbs.lavender }]} />
      <View pointerEvents="none" style={[styles.orb2, { backgroundColor: gradientOrbs.mint }]} />

      <Text style={styles.kicker}>PERSONALIZACJA</Text>
      <Text style={styles.h1}>Sklonuj swój głos</Text>
      <Text style={styles.lead}>
        Nagraj krótką próbkę, a Twoje wiadomości będą czytane Twoim własnym głosem.
        To wyróżnik VoiceThread — rozmowa, która naprawdę brzmi jak Ty.
      </Text>

      <View style={styles.planBadge}>
        <Text style={styles.planBadgeText}>
          ℹ️ Klonowanie używa ElevenLabs IVC i wymaga płatnego planu. Na darmowym koncie zobaczysz komunikat — wtedy wybierz gotowy głos.
        </Text>
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Twój głos teraz</Text>
        <Text style={styles.statusValue}>
          {result ? '✅ Twój sklonowany głos (aktywny)'
            : alreadyCloned ? '🎙 Sklonowany głos'
            : '🔉 Głos premade (domyślny)'}
        </Text>
        {(result || alreadyCloned) && (
          <TouchableOpacity
            style={styles.previewBtn}
            onPress={() => preview(result?.voiceId || profile.defaultVoiceId)}
            accessibilityLabel="Posłuchaj swojego głosu"
          >
            <Text style={styles.previewIcon}>{playing ? '❚❚' : '▶'}</Text>
            <Text style={styles.previewText}>Posłuchaj</Text>
          </TouchableOpacity>
        )}
      </View>

      {!result && (
        <>
          <View style={styles.scriptCard}>
            <Text style={styles.scriptLabel}>Przeczytaj na głos (~40 s)</Text>
            <Text style={styles.scriptText}>{SCRIPT}</Text>
          </View>

          <View style={styles.tipsCard}>
            <Text style={styles.tipsTitle}>Wskazówki — dla wiernego klonu</Text>
            {TIPS.map((t) => (
              <View key={t} style={styles.tipRow}>
                <Text style={styles.tipDot}>•</Text>
                <Text style={styles.tipText}>{t}</Text>
              </View>
            ))}
          </View>

          {/* Record / stop / re-record controls */}
          {clone.isRecording ? (
            <TouchableOpacity style={[styles.cta, styles.ctaRec]} onPress={clone.stop} accessibilityLabel="Zatrzymaj nagrywanie">
              <View style={styles.recDot} />
              <Text style={styles.ctaText}>Zatrzymaj  ·  {fmtDur(clone.durationMillis)}</Text>
            </TouchableOpacity>
          ) : clone.hasSample ? (
            <View style={styles.rowBtns}>
              <TouchableOpacity style={[styles.cta, styles.ctaGhost, styles.flex1]} onPress={clone.start} accessibilityLabel="Nagraj ponownie">
                <Text style={styles.ctaGhostText}>↻ Nagraj ponownie</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.cta, styles.flex1, clone.busy && styles.ctaDisabled]} onPress={onClone} disabled={clone.busy} accessibilityLabel="Sklonuj mój głos">
                {clone.busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.ctaText}>✨ Sklonuj mój głos</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.cta} onPress={clone.start} accessibilityLabel="Nagraj próbkę głosu">
              <Text style={styles.ctaText}>● Nagraj próbkę</Text>
            </TouchableOpacity>
          )}

          {!!clone.error && (
            <View style={styles.errCard}>
              <Text style={styles.errText}>{clone.error}</Text>
            </View>
          )}

          <Text style={styles.note}>
            Klonowanie korzysta z ElevenLabs IVC i wymaga płatnego planu. Na darmowym koncie
            zobaczysz komunikat — wtedy wybierz gotowy głos przy zakładaniu rozmowy. Klonuj tylko
            głos, do którego masz prawo.
          </Text>
        </>
      )}

      {result && (
        <View style={styles.successCard}>
          <Text style={styles.successTitle}>Gotowe! 🎉</Text>
          <Text style={styles.successText}>
            Twój głos „{result.name}" jest aktywny. Nowe rozmowy będą domyślnie czytane Twoim głosem.
          </Text>
          <TouchableOpacity style={[styles.cta, styles.ctaGhost, { marginTop: spacing.base }]} onPress={() => { setResult(null); clone.reset(); }}>
            <Text style={styles.ctaGhostText}>Nagraj jeszcze raz</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  orb: { position: 'absolute', top: -40, right: -50, width: 200, height: 200, borderRadius: 100, opacity: 0.1 },
  orb2: { position: 'absolute', top: 80, left: -70, width: 200, height: 200, borderRadius: 100, opacity: 0.08 },

  kicker: { ...type.overline, color: colors.muted, marginBottom: spacing.xs },
  h1: { ...type.displaySm, color: colors.ink, marginBottom: spacing.xs },
  lead: { ...type.body, color: colors.body, marginBottom: spacing.lg },

  statusCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: sizes.hairlineWidth,
    borderColor: colors.hairline, padding: spacing.base, marginBottom: spacing.base,
  },
  statusLabel: { ...type.overline, fontSize: 10, color: colors.mutedSoft, marginBottom: spacing.xxs },
  statusValue: { ...type.bodyStrong, color: colors.ink },
  previewBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    marginTop: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.base,
    borderRadius: radius.pill, backgroundColor: colors.surfaceStrong,
  },
  previewIcon: { fontSize: 12, fontWeight: '700', color: colors.ink, marginRight: spacing.xs },
  previewText: { ...type.button, color: colors.ink },

  scriptCard: {
    backgroundColor: colors.surfaceStrong, borderRadius: radius.xl, padding: spacing.base, marginBottom: spacing.base,
  },
  scriptLabel: { ...type.overline, fontSize: 10, color: colors.muted, marginBottom: spacing.xs },
  scriptText: { ...type.body, color: colors.ink, fontStyle: 'italic', lineHeight: 26 },

  planBadge: { backgroundColor: colors.surfaceStrong, borderRadius: radius.lg, paddingHorizontal: spacing.base, paddingVertical: spacing.sm, marginBottom: spacing.base },
  planBadgeText: { ...type.caption, color: colors.muted, lineHeight: 19 },

  tipsCard: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: sizes.hairlineWidth, borderColor: colors.hairline, padding: spacing.base, marginBottom: spacing.base },
  tipsTitle: { ...type.overline, fontSize: 10, color: colors.muted, marginBottom: spacing.sm },
  tipRow: { flexDirection: 'row', marginBottom: spacing.xs },
  tipDot: { ...type.body, color: colors.mutedSoft, marginRight: spacing.xs },
  tipText: { ...type.bodySm, color: colors.body, flex: 1, lineHeight: 20 },

  cta: {
    height: sizes.ctaHeight, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
  },
  ctaText: { ...type.button, fontSize: 16, color: colors.onPrimary },
  ctaRec: { backgroundColor: colors.primary },
  ctaDisabled: { opacity: 0.6 },
  ctaGhost: { backgroundColor: colors.surface, borderWidth: sizes.hairlineWidth, borderColor: colors.hairlineStrong },
  ctaGhostText: { ...type.button, fontSize: 15, color: colors.ink },
  rowBtns: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#ff6b6b', marginRight: spacing.sm },

  errCard: { backgroundColor: '#fdecec', borderRadius: radius.lg, padding: spacing.base, marginTop: spacing.base, borderWidth: sizes.hairlineWidth, borderColor: '#f5c6c6' },
  errText: { ...type.bodySm, color: colors.error },

  note: { ...type.caption, color: colors.mutedSoft, marginTop: spacing.base, lineHeight: 19 },

  successCard: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: sizes.hairlineWidth, borderColor: colors.hairline, padding: spacing.lg, marginTop: spacing.base },
  successTitle: { ...type.titleMd, color: colors.ink, marginBottom: spacing.xs },
  successText: { ...type.body, color: colors.body },
});
