// VoiceThread — ChatScreen.
// ----------------------------------------------------------------------------
// A voice-first 1:1 messenger thread over the Socket.IO relay. The SIGNATURE of
// this app is that every message carries on-device EMOTION METADATA — so each
// bubble visibly shows its detected feeling + intensity + the eleven_v3 audio
// tag that drives an accurate spoken replay in the contact's own voice.
//
// ElevenLabs visual language (docs/ELEVENLABS-BRAND.md): warm-stone canvas,
// monochrome bubbles, Inter type, hairlines — with the pastel "gradient-orb"
// hues used ONLY as the per-emotion accent (theme.emotionColors). Avatars +
// message grouping give it a familiar messenger feel.
//
// Behavior/contracts preserved: useChat relay, FlatList auto-scroll, typing
// indicator, playingId state, GET /api/tts playback.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, emotionColors, radius, sizes, spacing, type } from '../../theme';
import { useChat } from './useChat';

// Detected-emotion → emoji + Polish label + the eleven_v3 audio tag it maps to.
// Keys match the classifier set (src/features/emotion). The tag is what makes
// the spoken replay "accurate" — we surface it so the metadata is visible.
const EMOTION = {
  joy: { emoji: '😊', label: 'radość', tag: '[happy]' },
  sadness: { emoji: '😔', label: 'smutek', tag: '[sad]' },
  anger: { emoji: '😠', label: 'złość', tag: '[angry]' },
  fear: { emoji: '😨', label: 'niepokój', tag: '[nervous]' },
  affection: { emoji: '❤️', label: 'czułość', tag: '[warmly]' },
  surprise: { emoji: '😮', label: 'zaskoczenie', tag: '[surprised]' },
  neutral: { emoji: '🙂', label: 'spokojnie', tag: '' },
};

// --- helpers (pure) --------------------------------------------------------
function initials(name) {
  if (!name) return '?';
  const p = String(name).trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || String(name)[0].toUpperCase();
}
function formatTime(ts) {
  if (ts == null) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
function dateSeparatorLabel(ts, now = Date.now()) {
  if (ts == null) return '';
  const dayDiff = Math.round((startOfDay(new Date(now)) - startOfDay(new Date(ts))) / DAY_MS);
  if (dayDiff <= 0) return 'Dziś';
  if (dayDiff === 1) return 'Wczoraj';
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Build the render list: day separators + per-message run flags (for grouping
// + bottom-aligned avatars, the familiar messenger layout).
function buildItems(messages) {
  const out = [];
  let lastDayKey = null;
  messages.forEach((m, i) => {
    const dayKey = startOfDay(new Date(m.ts || 0));
    if (dayKey !== lastDayKey) {
      out.push({ _sep: true, id: `sep-${dayKey}`, label: dateSeparatorLabel(m.ts) });
      lastDayKey = dayKey;
    }
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const samePrev = prev && !!prev.mine === !!m.mine && startOfDay(new Date(prev.ts || 0)) === dayKey;
    const sameNext = next && !!next.mine === !!m.mine && startOfDay(new Date(next.ts || 0)) === dayKey;
    out.push({ _msg: true, ...m, firstOfRun: !samePrev, lastOfRun: !sameNext });
  });
  return out;
}

// --- small presentational pieces -------------------------------------------
function Avatar({ name, size = 32, tint }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }, tint && { borderColor: tint, borderWidth: 2 }]}>
      <Text style={[styles.avatarText, size < 32 && { fontSize: 12 }]}>{initials(name)}</Text>
    </View>
  );
}

// Static mini waveform — the voice-first "this is audio" cue. Tinted to the
// message emotion (incoming) or white (mine). Bars are deterministic.
const WAVE = [7, 13, 9, 16, 10, 14, 8];
function Waveform({ color, active }) {
  return (
    <View style={styles.wave}>
      {WAVE.map((h, i) => (
        <View key={i} style={[styles.waveBar, { height: active ? h + 3 : h, backgroundColor: color, opacity: active ? 1 : 0.65 }]} />
      ))}
    </View>
  );
}

// The signature element: a per-message EMOTION chip — emoji + label + an
// intensity meter + the audio tag — colored with the on-brand pastel accent.
function EmotionChip({ emotion, intensity, mine }) {
  const e = EMOTION[emotion] || EMOTION.neutral;
  const accent = emotionColors[emotion] || colors.mutedSoft;
  const pct = Math.max(0.12, Math.min(1, intensity || 0.4));
  return (
    <View style={[styles.chip, mine ? styles.chipMine : styles.chipTheirs]}>
      <Text style={styles.chipEmoji}>{e.emoji}</Text>
      <Text style={[styles.chipLabel, mine ? styles.chipLabelMine : styles.chipLabelTheirs]}>{e.label}</Text>
      <View style={[styles.meter, mine ? styles.meterMine : styles.meterTheirs]}>
        <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: accent, borderRadius: 999 }} />
      </View>
      {!!e.tag && (
        <Text style={[styles.tagText, mine ? styles.tagTextMine : styles.tagTextTheirs]}>{e.tag}</Text>
      )}
    </View>
  );
}

function Bubble({ msg, onPlay, playing, contactName }) {
  const mine = msg.mine;
  const accent = emotionColors[msg.emotion] || colors.hairline;
  const waveColor = mine ? 'rgba(255,255,255,0.8)' : accent;
  return (
    <View
      style={[
        styles.row,
        mine ? styles.rowMine : styles.rowTheirs,
        { marginTop: msg.firstOfRun ? spacing.sm : spacing.xxs },
      ]}
    >
      {/* incoming avatar slot (bottom-aligned, only on the last of a run) */}
      {!mine && (
        <View style={styles.avatarSlot}>
          {msg.lastOfRun ? <Avatar name={contactName} size={28} /> : null}
        </View>
      )}

      <View style={styles.bubbleWrap}>
        <View
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleTheirs,
            !mine && { borderLeftWidth: 3, borderLeftColor: accent },
            mine && msg.lastOfRun && styles.tailMine,
            !mine && msg.lastOfRun && styles.tailTheirs,
          ]}
        >
          <Text style={[styles.bubbleText, mine ? styles.textMine : styles.textTheirs]}>{msg.text}</Text>

          {/* SIGNATURE: visible emotion metadata on every message */}
          {!!msg.emotion && <EmotionChip emotion={msg.emotion} intensity={msg.intensity} mine={mine} />}

          {/* voice-first play row + time + receipt */}
          <View style={styles.footer}>
            <TouchableOpacity
              onPress={() => onPlay(msg.id)}
              hitSlop={sizes.hitSlop}
              style={[styles.playBtn, mine ? styles.playBtnMine : styles.playBtnTheirs]}
              accessibilityLabel={`Odtwórz głosem (${contactName || 'kontakt'})`}
            >
              <Text style={[styles.playIcon, mine ? styles.textMine : styles.textTheirs]}>{playing ? '❚❚' : '▶'}</Text>
              <Waveform color={waveColor} active={playing} />
            </TouchableOpacity>
            <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>{formatTime(msg.ts)}</Text>
            {mine && <Text style={[styles.tick, msg.status === 'seen' && styles.tickSeen]}>{msg.status === 'sent' ? '✓' : '✓✓'}</Text>}
          </View>
        </View>
      </View>
    </View>
  );
}

function DateSeparator({ label }) {
  return (
    <View style={styles.sepRow}>
      <View style={styles.sepPill}><Text style={styles.sepText}>{label}</Text></View>
    </View>
  );
}

export default function ChatScreen({ roomId, userId, displayName, myVoiceId, contactVoiceId, title }) {
  const { messages, peer, peerTyping, connection, playingId, send, play, setTyping } = useChat({
    roomId, userId, displayName, myVoiceId, contactVoiceId,
  });

  const [draft, setDraft] = useState('');
  const listRef = useRef(null);
  const typingTimer = useRef(null);

  const contactName = title || peer?.displayName || 'Rozmowa';
  const items = useMemo(() => buildItems(messages), [messages]);

  useEffect(() => {
    if (messages.length) {
      requestAnimationFrame(() => {
        try { listRef.current?.scrollToEnd({ animated: true }); } catch { /* ignore */ }
      });
    }
  }, [messages.length, peerTyping]);

  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  function onChange(text) {
    setDraft(text);
    setTyping(text.length > 0);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1500);
  }
  function onSend() {
    if (send(draft)) setDraft('');
  }

  const presence =
    peerTyping ? 'pisze…'
    : connection === 'online' ? 'online'
    : connection === 'offline' ? 'offline'
    : 'łączę…';
  const presenceColor =
    connection === 'online' ? colors.success
    : connection === 'offline' ? colors.error
    : colors.mutedSoft;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" />

      {/* Header: avatar + name + presence — familiar messenger chrome. */}
      <View style={styles.header}>
        <Avatar name={contactName} size={40} />
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{contactName}</Text>
          <View style={styles.presenceRow}>
            <View style={[styles.dot, { backgroundColor: presenceColor }]} />
            <Text style={[styles.presence, peerTyping && styles.presenceTyping]}>{presence}</Text>
          </View>
        </View>
        <View style={styles.headerVoice}>
          <Text style={styles.headerVoiceLabel}>głos</Text>
          <Text style={styles.headerVoiceName} numberOfLines={1}>🎙 {contactName}</Text>
        </View>
      </View>

      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={items}
        keyExtractor={(it) => it.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) =>
          item._sep ? (
            <DateSeparator label={item.label} />
          ) : (
            <Bubble msg={item} onPlay={play} playing={playingId === item.id} contactName={contactName} />
          )
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🎧</Text>
            <Text style={styles.emptyTitle}>Rozmowa głosem</Text>
            <Text style={styles.emptyText}>Wyślij wiadomość — odbiorca usłyszy ją Twoim głosem, z wykrytą emocją.</Text>
          </View>
        }
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={onChange}
          placeholder="Napisz — usłyszą to z emocją…"
          placeholderTextColor={colors.mutedSoft}
          multiline
          onSubmitEditing={onSend}
          returnKeyType="send"
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, !draft.trim() && styles.sendBtnOff]}
          onPress={onSend}
          disabled={!draft.trim()}
          accessibilityLabel="Wyślij"
        >
          <Text style={styles.sendIcon}>↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },

  // Header
  header: {
    paddingTop: sizes.headerTopPad,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    borderBottomWidth: sizes.hairlineWidth,
    borderBottomColor: colors.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  headerText: { flex: 1, marginLeft: spacing.sm },
  title: { ...type.titleMd, color: colors.ink },
  presenceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: spacing.xs },
  presence: { ...type.caption, color: colors.muted },
  presenceTyping: { fontStyle: 'italic', color: colors.muted },
  headerVoice: { alignItems: 'flex-end', maxWidth: 120 },
  headerVoiceLabel: { ...type.overline, fontSize: 9, color: colors.mutedSoft, letterSpacing: 0.8 },
  headerVoiceName: { ...type.caption, color: colors.body },

  // Avatar
  avatar: { backgroundColor: colors.surfaceStrong, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...type.button, color: colors.primary, fontSize: 14 },

  list: { flex: 1 },
  listContent: { padding: spacing.base, paddingBottom: spacing.xs, flexGrow: 1 },

  row: { width: '100%', flexDirection: 'row', alignItems: 'flex-end' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  avatarSlot: { width: 28, marginRight: spacing.xs, alignItems: 'center', justifyContent: 'flex-end' },

  bubbleWrap: { maxWidth: '82%' },
  bubble: { borderRadius: radius.xl, paddingVertical: spacing.sm, paddingHorizontal: spacing.base },
  bubbleMine: { backgroundColor: colors.ink, borderTopRightRadius: radius.xl, borderBottomRightRadius: radius.xl },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: sizes.hairlineWidth, borderColor: colors.hairline },
  tailMine: { borderBottomRightRadius: radius.sm },
  tailTheirs: { borderBottomLeftRadius: radius.sm },
  bubbleText: { ...type.body },
  textMine: { color: colors.onPrimary },
  textTheirs: { color: colors.ink },

  // Emotion chip (the signature)
  chip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    marginTop: spacing.xs, paddingVertical: 3, paddingHorizontal: spacing.xs,
    borderRadius: radius.pill,
  },
  chipTheirs: { backgroundColor: colors.surfaceStrong },
  chipMine: { backgroundColor: 'rgba(255,255,255,0.12)' },
  chipEmoji: { fontSize: 13, marginRight: 5 },
  chipLabel: { ...type.caption, fontSize: 11.5, fontWeight: '600' },
  chipLabelTheirs: { color: colors.body },
  chipLabelMine: { color: 'rgba(255,255,255,0.92)' },
  meter: { width: 34, height: 4, borderRadius: 999, marginLeft: 7, overflow: 'hidden' },
  meterTheirs: { backgroundColor: colors.hairline },
  meterMine: { backgroundColor: 'rgba(255,255,255,0.22)' },
  tagText: { ...type.caption, fontSize: 10, marginLeft: 7, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  tagTextTheirs: { color: colors.mutedSoft },
  tagTextMine: { color: 'rgba(255,255,255,0.55)' },

  // Footer: play + waveform + time + tick
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  playBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 5, paddingHorizontal: spacing.xs, borderRadius: radius.pill,
  },
  playBtnMine: { backgroundColor: 'rgba(255,255,255,0.14)' },
  playBtnTheirs: { backgroundColor: 'rgba(12,10,9,0.05)' },
  playIcon: { fontSize: 11, fontWeight: '700', marginRight: spacing.xs },
  wave: { flexDirection: 'row', alignItems: 'center', height: 18 },
  waveBar: { width: 2.5, borderRadius: 2, marginRight: 2 },
  time: { ...type.caption, fontSize: 11, lineHeight: 14, marginLeft: 'auto' },
  timeMine: { color: 'rgba(255,255,255,0.6)' },
  timeTheirs: { color: colors.mutedSoft },
  tick: { ...type.caption, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginLeft: spacing.xs },
  tickSeen: { color: gradientOrbsSeenTick() },

  // Day separator
  sepRow: { alignItems: 'center', marginVertical: spacing.sm },
  sepPill: { backgroundColor: colors.surfaceStrong, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  sepText: { ...type.caption, fontSize: 12, color: colors.muted },

  // Empty state
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.sm },
  emptyTitle: { ...type.titleSm, color: colors.ink, marginBottom: spacing.xs },
  emptyText: { ...type.bodySm, color: colors.muted, textAlign: 'center', maxWidth: 280 },

  // Composer
  composer: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: spacing.sm, paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.sm,
    borderTopWidth: sizes.hairlineWidth, borderTopColor: colors.hairline, backgroundColor: colors.canvas,
  },
  input: {
    flex: 1, ...type.body, backgroundColor: colors.surface, color: colors.ink,
    borderWidth: sizes.hairlineWidth, borderColor: colors.hairlineStrong, borderRadius: radius.md,
    paddingHorizontal: sizes.inputPadH, paddingTop: sizes.inputPadV, paddingBottom: sizes.inputPadV,
    minHeight: sizes.inputMinHeight, maxHeight: 120, marginRight: spacing.xs,
  },
  sendBtn: { width: sizes.ctaHeightMin, height: sizes.ctaHeightMin, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { backgroundColor: colors.mutedSoft },
  sendIcon: { color: colors.onPrimary, fontSize: 22, fontWeight: '700', lineHeight: 24 },
});

// "seen" tick uses a soft mint to read as a positive confirmation on the ink
// bubble without introducing a saturated UI color.
function gradientOrbsSeenTick() { return '#a7e5d3'; }
