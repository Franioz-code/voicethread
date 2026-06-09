// VoiceThread — ChatScreen.
// ----------------------------------------------------------------------------
// A voice-first 1:1 messenger thread over the Socket.IO relay. The SIGNATURE of
// this app is that every message carries on-device EMOTION METADATA — so each
// bubble visibly shows its detected feeling + intensity + the eleven_v3 audio
// tag that drives an accurate spoken replay in the contact's own voice.
//
// VOICE-FIRST input: a 🎙 mic in the composer dictates a message (record →
// /api/stt Scribe → text). A hands-free toggle auto-reads incoming messages
// aloud and lets you reply by voice with one tap (auto-send).
//
// ElevenLabs visual language: warm-stone canvas, monochrome bubbles, Inter type,
// hairlines, with pastel "gradient-orb" hues as the per-emotion accent.

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
import { colors, emotionColors, gradientOrbs, radius, sizes, spacing, type } from '../../theme';
import { useChat } from './useChat';
import { useVoiceInput } from './useVoiceInput';

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
function fmtDur(ms) {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
      {!!e.tag && <Text style={[styles.tagText, mine ? styles.tagTextMine : styles.tagTextTheirs]}>{e.tag}</Text>}
    </View>
  );
}

function Bubble({ msg, onPlay, playing, contactName }) {
  const mine = msg.mine;
  const accent = emotionColors[msg.emotion] || colors.hairline;
  const waveColor = mine ? 'rgba(255,255,255,0.8)' : accent;
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, { marginTop: msg.firstOfRun ? spacing.sm : spacing.xxs }]}>
      {!mine && <View style={styles.avatarSlot}>{msg.lastOfRun ? <Avatar name={contactName} size={28} /> : null}</View>}
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
          {!!msg.emotion && <EmotionChip emotion={msg.emotion} intensity={msg.intensity} mine={mine} />}
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

export default function ChatScreen({ roomId, userId, displayName, myVoiceId, contactVoiceId, title, onBack }) {
  const { messages, peer, peerTyping, connection, playingId, send, play, setTyping } = useChat({
    roomId, userId, displayName, myVoiceId, contactVoiceId,
  });
  const voice = useVoiceInput();

  const [draft, setDraft] = useState('');
  const [handsFree, setHandsFree] = useState(false);
  const [voiceEmotion, setVoiceEmotion] = useState(null); // emotion detected from the spoken recording
  const listRef = useRef(null);
  const typingTimer = useRef(null);
  const lastReadRef = useRef(null);

  const contactName = title || peer?.displayName || 'Rozmowa';
  const items = useMemo(() => buildItems(messages), [messages]);

  useEffect(() => {
    if (messages.length) {
      requestAnimationFrame(() => {
        try { listRef.current?.scrollToEnd({ animated: true }); } catch { /* ignore */ }
      });
    }
  }, [messages.length, peerTyping]);

  // Hands-free: auto-read each NEW incoming message aloud (in the contact's voice).
  useEffect(() => {
    if (!handsFree || !messages.length) return;
    const last = messages[messages.length - 1];
    if (!last.mine && last.id !== lastReadRef.current) {
      lastReadRef.current = last.id;
      play(last.id);
    }
  }, [messages, handsFree, play]);

  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  function onChange(text) {
    setDraft(text);
    setVoiceEmotion(null); // typed/edited text → emotion comes from text again
    setTyping(text.length > 0);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1500);
  }
  function onSend() {
    if (send(draft, voiceEmotion)) { setDraft(''); setVoiceEmotion(null); }
  }

  // --- voice dictation -----------------------------------------------------
  async function micStart() {
    voice.clearError();
    await voice.start();
  }
  async function micDone() {
    const { text, voiceEmotion: ve } = await voice.stopAndTranscribe();
    if (!text) return;
    if (handsFree) {
      send(text, ve); // hands-free → speak-to-send, emotion FROM your voice
    } else {
      setVoiceEmotion(ve || null);
      setDraft((d) => (d ? `${d} ${text}` : text)); // review, then send (keeps voice emotion)
    }
  }
  function micCancel() { voice.cancel(); }

  const presence = peerTyping ? 'pisze…'
    : connection === 'online' ? 'online'
    : connection === 'offline' ? 'offline'
    : 'łączę…';
  const presenceColor = connection === 'online' ? colors.success
    : connection === 'offline' ? colors.error : colors.mutedSoft;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack} hitSlop={sizes.hitSlop} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Wróć do listy rozmów">
            <Text style={styles.backChevron}>‹</Text>
          </TouchableOpacity>
        )}
        <Avatar name={contactName} size={40} />
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{contactName}</Text>
          <View style={styles.presenceRow}>
            <View style={[styles.dot, { backgroundColor: presenceColor }]} />
            <Text style={[styles.presence, peerTyping && styles.presenceTyping]}>{presence}</Text>
          </View>
        </View>
        {/* Hands-free toggle: auto-reads incoming + speak-to-send replies. */}
        <TouchableOpacity
          onPress={() => setHandsFree((v) => !v)}
          style={[styles.hf, handsFree && styles.hfOn]}
          accessibilityRole="switch"
          accessibilityState={{ checked: handsFree }}
          accessibilityLabel="Tryb bezdotykowy — czyta na głos i odpowiadasz mówiąc"
        >
          <Text style={[styles.hfIcon, handsFree && styles.hfTextOn]}>🖐</Text>
          <Text style={[styles.hfText, handsFree && styles.hfTextOn]}>{handsFree ? 'Bezdotykowo' : 'Bezdotykowo'}</Text>
        </TouchableOpacity>
      </View>

      {handsFree && (
        <View style={styles.hfBanner}>
          <Text style={styles.hfBannerText}>🎧 Czytam wiadomości na głos. Dotknij 🎙 i mów — wyślę od razu.</Text>
        </View>
      )}

      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={items}
        keyExtractor={(it) => it.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) =>
          item._sep ? <DateSeparator label={item.label} /> : <Bubble msg={item} onPlay={play} playing={playingId === item.id} contactName={contactName} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🎧</Text>
            <Text style={styles.emptyTitle}>Rozmowa głosem</Text>
            <Text style={styles.emptyText}>Napisz lub powiedz wiadomość 🎙 — odbiorca usłyszy ją Twoim głosem, z wykrytą emocją.</Text>
          </View>
        }
      />

      {!!voice.error && (
        <View style={styles.errBar}><Text style={styles.errText}>{voice.error}</Text></View>
      )}

      {voiceEmotion && !voice.isRecording && !voice.busy && (
        <View style={styles.veBar}>
          <Text style={styles.veText}>
            🎙 emocja z głosu: {(EMOTION[voiceEmotion.emotion] || EMOTION.neutral).emoji} {(EMOTION[voiceEmotion.emotion] || EMOTION.neutral).label}
          </Text>
        </View>
      )}

      {/* Composer: recording bar / transcribing / normal (mic + input + send) */}
      {voice.isRecording ? (
        <View style={styles.composer}>
          <View style={styles.recDot} />
          <Text style={styles.recText}>Nagrywanie… {fmtDur(voice.durationMillis)}</Text>
          <TouchableOpacity onPress={micCancel} style={styles.recCancel} accessibilityLabel="Anuluj nagrywanie">
            <Text style={styles.recCancelText}>Anuluj</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={micDone} style={styles.recDone} accessibilityLabel="Zakończ i przepisz">
            <Text style={styles.recDoneText}>Gotowe</Text>
          </TouchableOpacity>
        </View>
      ) : voice.busy ? (
        <View style={styles.composer}>
          <Text style={styles.busyText}>⏳ Przetwarzam mowę…</Text>
        </View>
      ) : (
        <View style={styles.composer}>
          <TouchableOpacity onPress={micStart} style={styles.micBtn} accessibilityLabel="Powiedz wiadomość">
            <Text style={styles.micIcon}>🎙</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={onChange}
            placeholder="Napisz lub powiedz 🎙…"
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
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },

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
  backBtn: { paddingRight: spacing.xs, justifyContent: 'center' },
  backChevron: { fontSize: 30, color: colors.ink, lineHeight: 32, marginTop: -2 },
  headerText: { flex: 1, marginLeft: spacing.sm },
  title: { ...type.titleMd, color: colors.ink },
  presenceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: spacing.xs },
  presence: { ...type.caption, color: colors.muted },
  presenceTyping: { fontStyle: 'italic', color: colors.muted },

  // Hands-free toggle pill.
  hf: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.pill,
    borderWidth: sizes.hairlineWidth, borderColor: colors.hairlineStrong, backgroundColor: colors.surface,
  },
  hfOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  hfIcon: { fontSize: 14, marginRight: 6 },
  hfText: { ...type.caption, fontSize: 12, fontWeight: '600', color: colors.muted },
  hfTextOn: { color: colors.onPrimary },
  hfBanner: { backgroundColor: colors.surfaceStrong, paddingHorizontal: spacing.base, paddingVertical: spacing.xs },
  hfBannerText: { ...type.caption, fontSize: 12, color: colors.body, textAlign: 'center' },

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
  bubbleMine: { backgroundColor: colors.ink },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: sizes.hairlineWidth, borderColor: colors.hairline },
  tailMine: { borderBottomRightRadius: radius.sm },
  tailTheirs: { borderBottomLeftRadius: radius.sm },
  bubbleText: { ...type.body },
  textMine: { color: colors.onPrimary },
  textTheirs: { color: colors.ink },

  chip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    marginTop: spacing.xs, paddingVertical: 3, paddingHorizontal: spacing.xs, borderRadius: radius.pill,
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

  footer: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  playBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingHorizontal: spacing.xs, borderRadius: radius.pill },
  playBtnMine: { backgroundColor: 'rgba(255,255,255,0.14)' },
  playBtnTheirs: { backgroundColor: 'rgba(12,10,9,0.05)' },
  playIcon: { fontSize: 11, fontWeight: '700', marginRight: spacing.xs },
  wave: { flexDirection: 'row', alignItems: 'center', height: 18 },
  waveBar: { width: 2.5, borderRadius: 2, marginRight: 2 },
  time: { ...type.caption, fontSize: 11, lineHeight: 14, marginLeft: 'auto' },
  timeMine: { color: 'rgba(255,255,255,0.6)' },
  timeTheirs: { color: colors.mutedSoft },
  tick: { ...type.caption, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginLeft: spacing.xs },
  tickSeen: { color: gradientOrbs.mint },

  sepRow: { alignItems: 'center', marginVertical: spacing.sm },
  sepPill: { backgroundColor: colors.surfaceStrong, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  sepText: { ...type.caption, fontSize: 12, color: colors.muted },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.sm },
  emptyTitle: { ...type.titleSm, color: colors.ink, marginBottom: spacing.xs },
  emptyText: { ...type.bodySm, color: colors.muted, textAlign: 'center', maxWidth: 280 },

  errBar: { backgroundColor: '#fdecec', paddingHorizontal: spacing.base, paddingVertical: spacing.xs, borderTopWidth: sizes.hairlineWidth, borderTopColor: '#f5c6c6' },
  errText: { ...type.caption, fontSize: 12, color: colors.error, textAlign: 'center' },
  veBar: { backgroundColor: colors.surfaceStrong, paddingHorizontal: spacing.base, paddingVertical: spacing.xs },
  veText: { ...type.caption, fontSize: 12, color: colors.body, textAlign: 'center' },

  composer: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.sm,
    borderTopWidth: sizes.hairlineWidth, borderTopColor: colors.hairline, backgroundColor: colors.canvas,
  },
  micBtn: {
    width: sizes.ctaHeightMin, height: sizes.ctaHeightMin, borderRadius: radius.pill,
    backgroundColor: colors.surfaceStrong, borderWidth: sizes.hairlineWidth, borderColor: colors.hairlineStrong,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.xs,
  },
  micIcon: { fontSize: 20 },
  input: {
    flex: 1, ...type.body, backgroundColor: colors.surface, color: colors.ink,
    borderWidth: sizes.hairlineWidth, borderColor: colors.hairlineStrong, borderRadius: radius.md,
    paddingHorizontal: sizes.inputPadH, paddingTop: sizes.inputPadV, paddingBottom: sizes.inputPadV,
    minHeight: sizes.inputMinHeight, maxHeight: 120, marginRight: spacing.xs,
  },
  sendBtn: { width: sizes.ctaHeightMin, height: sizes.ctaHeightMin, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { backgroundColor: colors.mutedSoft },
  sendIcon: { color: colors.onPrimary, fontSize: 22, fontWeight: '700', lineHeight: 24 },

  // Recording bar
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.error, marginRight: spacing.sm },
  recText: { ...type.body, color: colors.ink, flex: 1 },
  recCancel: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, marginRight: spacing.xs },
  recCancelText: { ...type.button, color: colors.muted },
  recDone: { paddingVertical: spacing.xs, paddingHorizontal: spacing.base, borderRadius: radius.pill, backgroundColor: colors.ink },
  recDoneText: { ...type.button, color: colors.onPrimary },
  busyText: { ...type.body, color: colors.muted, paddingVertical: spacing.sm },
});
