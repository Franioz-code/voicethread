// VoiceThread — ChatScreen (milestone 2).
// ----------------------------------------------------------------------------
// Two-phone chat over the existing Socket.IO relay, re-skinned to the
// ElevenLabs visual language (see docs/ELEVENLABS-BRAND.md): light warm-stone
// canvas, monochrome bubbles (incoming = surface + ink, outgoing = ink +
// onPrimary), hairline borders, ink composer CTA — NOT iMessage blue. Each
// bubble keeps its ▶ button that speaks it with the on-device emotion pipeline
// + ElevenLabs TTS (GET /api/tts via the useChat hook).
//
// This is a RE-SKIN: all behavior/contracts are preserved verbatim — the
// useChat relay, FlatList auto-scroll, typing indicator, emotion badge,
// playingId state and TTS integration are untouched.
//
// Mount example (UX owns App.js — see wiringNotes):
//   <ChatScreen
//     roomId="demo-1234"
//     userId="franek"
//     displayName="Franek"
//     myVoiceId={myVoiceId}
//     contactVoiceId={contactVoiceId}
//   />

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
import { colors, radius, sizes, spacing, type } from '../../theme';
import { useChat } from './useChat';

const EMOJI = {
  joy: '😊', sadness: '😔', anger: '😠', fear: '😨',
  affection: '❤️', surprise: '😮', neutral: '',
};

// --- date / time helpers (pure, screen-local) ------------------------------
// Two-digit clock for the per-message timestamp, e.g. "09:05". Local time.
function formatTime(ts) {
  if (ts == null) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Day-separator label between message groups: "Dziś" / "Wczoraj" / "DD.MM"
// (zero-padded day.month for anything older). Polish, locale-free, deterministic.
function dateSeparatorLabel(ts, now = Date.now()) {
  if (ts == null) return '';
  const dayDiff = Math.round((startOfDay(new Date(now)) - startOfDay(new Date(ts))) / DAY_MS);
  if (dayDiff <= 0) return 'Dziś';
  if (dayDiff === 1) return 'Wczoraj';
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
}

// Interleave day-separator rows into the message list so the FlatList renders
// "Dziś / Wczoraj / DD.MM" headers between days. Pure: maps a messages[] to a
// mixed list of { _sep, id, label } and { _msg, ...message } rows.
function withDateSeparators(messages) {
  const out = [];
  let lastDayKey = null;
  for (const m of messages) {
    const dayKey = startOfDay(new Date(m.ts || 0));
    if (dayKey !== lastDayKey) {
      out.push({ _sep: true, id: `sep-${dayKey}`, label: dateSeparatorLabel(m.ts) });
      lastDayKey = dayKey;
    }
    out.push({ _msg: true, ...m });
  }
  return out;
}

// Centered, calm day separator — monochrome pill on the canvas (hairline border).
function DateSeparator({ label }) {
  return (
    <View style={styles.sepRow} accessibilityRole="text" accessibilityLabel={label}>
      <View style={styles.sepPill}>
        <Text style={styles.sepText}>{label}</Text>
      </View>
    </View>
  );
}

function ConnDot({ connection }) {
  // Status uses the brand's sparing status colors (success/error) with a calm
  // muted "connecting" — never a saturated UI palette.
  const color =
    connection === 'online' ? colors.success
    : connection === 'offline' ? colors.error
    : colors.mutedSoft;
  const label =
    connection === 'online' ? 'połączono'
    : connection === 'offline' ? 'offline'
    : 'łączę…';
  return (
    <View style={styles.connRow}>
      <View style={[styles.connDot, { backgroundColor: color }]} />
      <Text style={styles.connText}>{label}</Text>
    </View>
  );
}

function Bubble({ msg, onPlay, playing }) {
  const mine = msg.mine;
  const emoji = EMOJI[msg.emotion] || '';
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={[styles.bubbleText, mine ? styles.textMine : styles.textTheirs]}>
          {msg.text}
        </Text>
        <View style={styles.bubbleFooter}>
          <TouchableOpacity
            onPress={() => onPlay(msg.id)}
            hitSlop={sizes.hitSlop}
            style={[styles.playBtn, mine ? styles.playBtnMine : styles.playBtnTheirs]}
            accessibilityLabel="Odtwórz wiadomość głosowo"
          >
            <Text style={[styles.playIcon, mine ? styles.textMine : styles.textTheirs]}>
              {playing ? '❚❚' : '▶'}
            </Text>
          </TouchableOpacity>
          {!!emoji && <Text style={styles.bubbleEmoji}>{emoji}</Text>}
          {/* Per-message timestamp — tinted to the bubble side, pushed to the
              trailing edge so it sits with the receipt tick. */}
          <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>
            {formatTime(msg.ts)}
          </Text>
          {mine && (
            <Text style={styles.tick}>
              {msg.status === 'delivered' ? '✓✓' : '✓'}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

export default function ChatScreen({
  roomId,
  userId,
  displayName,
  myVoiceId,
  contactVoiceId,
  title,
}) {
  const {
    messages,
    peer,
    peerTyping,
    connection,
    playingId,
    send,
    play,
    setTyping,
  } = useChat({ roomId, userId, displayName, myVoiceId, contactVoiceId });

  const [draft, setDraft] = useState('');
  const listRef = useRef(null);
  const typingTimer = useRef(null);

  // Interleave day separators ("Dziś / Wczoraj / DD.MM") between message days.
  const items = useMemo(() => withDateSeparators(messages), [messages]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    if (messages.length) {
      requestAnimationFrame(() => {
        try { listRef.current?.scrollToEnd({ animated: true }); } catch { /* ignore */ }
      });
    }
  }, [messages.length, peerTyping]);

  // Stop the typing indicator if the user goes idle.
  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  function onChange(text) {
    setDraft(text);
    setTyping(text.length > 0);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1500);
  }

  function onSend() {
    const sent = send(draft);
    if (sent) setDraft('');
  }

  const headerTitle = title || peer?.displayName || 'Rozmowa';

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title} numberOfLines={1}>{headerTitle}</Text>
          {peerTyping ? (
            <Text style={styles.subtitle}>pisze…</Text>
          ) : (
            <ConnDot connection={connection} />
          )}
        </View>
        <Text style={styles.room} numberOfLines={1}>#{roomId}</Text>
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
            <Bubble msg={item} onPlay={play} playing={playingId === item.id} />
          )
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Wyślij pierwszą wiadomość — przeczyta ją głos z emocjami.
            </Text>
          </View>
        }
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={onChange}
          placeholder="Wiadomość…"
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
  // Light editorial canvas — NOT dark. Generous whitespace, hairlines, ink text.
  screen: { flex: 1, backgroundColor: colors.canvas },

  // Header: canvas bg, hairline divider at the bottom, Inter type, ink text.
  header: {
    paddingTop: sizes.headerTopPad,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    borderBottomWidth: sizes.hairlineWidth,
    borderBottomColor: colors.hairline,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    backgroundColor: colors.canvas,
  },
  headerTextWrap: { flex: 1, paddingRight: spacing.sm },
  title: { ...type.titleMd, color: colors.ink },
  subtitle: { ...type.caption, color: colors.muted, marginTop: spacing.xxs, fontStyle: 'italic' },
  room: { ...type.caption, color: colors.mutedSoft },

  connRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xxs },
  connDot: { width: spacing.xs, height: spacing.xs, borderRadius: spacing.xxs, marginRight: spacing.xs },
  connText: { ...type.caption, color: colors.muted },

  list: { flex: 1 },
  listContent: { padding: spacing.base, paddingBottom: spacing.xs, flexGrow: 1 },

  row: { width: '100%', marginVertical: spacing.xxs, flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },

  // Monochrome bubbles. 16px body corners, tight 6px tail corner near the sender.
  bubble: {
    maxWidth: '80%',
    borderRadius: radius.xl,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
  },
  // OUTGOING (mine) = ink fill + onPrimary text.
  bubbleMine: { backgroundColor: colors.ink, borderBottomRightRadius: radius.sm },
  // INCOMING (theirs) = surface fill + ink text, hairline so it reads on canvas.
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radius.sm,
    borderWidth: sizes.hairlineWidth,
    borderColor: colors.hairline,
  },
  bubbleText: { ...type.body },
  textMine: { color: colors.onPrimary },
  textTheirs: { color: colors.ink },

  bubbleFooter: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  // Play affordance: semi-transparent overlay tinted to each bubble's text color.
  playBtn: {
    width: 26, height: 26, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.xs,
  },
  playBtnMine: { backgroundColor: 'rgba(255,255,255,0.16)' },
  playBtnTheirs: { backgroundColor: 'rgba(12,10,9,0.06)' },
  playIcon: { fontSize: 12, fontWeight: '700' },
  bubbleEmoji: { fontSize: 14, marginRight: spacing.xs },
  // Timestamp — small, quiet, pushed to the trailing edge (tick follows it).
  time: { ...type.caption, fontSize: 11, lineHeight: 14, marginLeft: 'auto' },
  timeMine: { color: 'rgba(255,255,255,0.6)' },
  timeTheirs: { color: colors.mutedSoft },
  tick: { ...type.caption, color: 'rgba(255,255,255,0.6)', marginLeft: spacing.xs },

  // Day separator — centered monochrome pill (surface + hairline) on the canvas.
  sepRow: { alignItems: 'center', marginVertical: spacing.sm },
  sepPill: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  sepText: { ...type.caption, fontSize: 12, color: colors.muted },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { ...type.bodySm, color: colors.muted, textAlign: 'center' },

  // Composer: canvas bar with a hairline top, surface input (md radius), ink pill send.
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.sm,
    borderTopWidth: sizes.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.canvas,
  },
  input: {
    flex: 1,
    ...type.body,
    backgroundColor: colors.surface,
    color: colors.ink,
    borderWidth: sizes.hairlineWidth,
    borderColor: colors.hairlineStrong,
    borderRadius: radius.md,
    paddingHorizontal: sizes.inputPadH,
    paddingTop: sizes.inputPadV,
    paddingBottom: sizes.inputPadV,
    minHeight: sizes.inputMinHeight,
    maxHeight: 120,
    marginRight: spacing.xs,
  },
  // Ink pill CTA, 48px tap target. Disabled → muted-soft fill (still legible arrow).
  sendBtn: {
    width: sizes.ctaHeightMin, height: sizes.ctaHeightMin, borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnOff: { backgroundColor: colors.mutedSoft },
  sendIcon: { color: colors.onPrimary, fontSize: 22, fontWeight: '700', lineHeight: 24 },
});
