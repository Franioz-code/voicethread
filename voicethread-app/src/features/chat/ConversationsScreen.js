// VoiceThread — ConversationsScreen (milestone 2: the home chat list).
// ----------------------------------------------------------------------------
// The default "home" once you have chats: a FlatList of conversations (contact
// name, last-message preview, relative time, unread badge) with a "+ New chat"
// pill at the top. Replaces the single setup screen as the landing surface
// (see docs/MESSENGER-FEATURES.md → "Conversation list").
//
// VISUAL LANGUAGE — ElevenLabs (see docs/ELEVENLABS-BRAND.md): light warm-stone
// canvas, surface cards with hairline borders, Inter type (light/tight display,
// positive-tracked body), an ink pill CTA — monochrome throughout (no saturated
// UI colors). Mirrors the recipes already used in App.js / ChatScreen so the app
// reads as one design.
//
// PRESENTATIONAL / PROPS-DRIVEN (privacy-by-design): this screen renders data it
// is GIVEN and reports taps UP via callbacks — it owns no relay/DB wiring (that
// stays in useChat / src/db, owned by other roles). The conversation shape it
// expects is exactly repo.rowToConversation (camelCase), so the data layer drops
// straight in:
//   { id, roomCode, contactName, peerDisplayName, contactVoiceId, myVoiceId,
//     lastMessagePreview, lastMessageAt, unreadCount, ... }
//
// NAVIGATION (structure only — the new-chat flow is intentionally NOT wired yet):
//   • Tapping a row → onOpenConversation({ roomId, contactName, contactVoiceId,
//     myVoiceId, displayName, conversation }) — `roomId` (= roomCode) + contact
//     data are exactly what ChatScreen consumes.
//   • Tapping "+ New chat" → onNewChat() — the parent opens the new-chat flow.
//
// Mount example (App.js routing, added in a later step):
//   <ConversationsScreen
//     conversations={conversations}
//     onOpenConversation={(c) => setChatSession(c)}
//     onNewChat={() => setMode('newChat')}
//   />

import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FlatList } from 'react-native';
import { colors, radius, sizes, spacing, type } from '../../theme';

// --- helpers (pure, screen-local) ------------------------------------------

// Truncate a preview to <= 40 chars, with an ellipsis when clipped (AC: 40-char
// preview). Whitespace is collapsed so a multi-line message reads as one line.
const PREVIEW_MAX = 40;
export function truncatePreview(text, max = PREVIEW_MAX) {
  const s = (text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  // Reserve one slot for the ellipsis; trim a trailing space before it.
  return s.slice(0, max - 1).replace(/\s+$/, '') + '…';
}

// Relative time for the list ("Teraz", "5 min temu", "2 godz. temu", "Wczoraj",
// "Dziś", or a short date). Polish to match the rest of the app's copy. Pure: no
// Intl/locale dependency, deterministic given `now`.
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export function relativeTime(ts, now = Date.now()) {
  if (ts == null) return '';
  const diff = now - ts;
  if (diff < 0) return 'Teraz';
  if (diff < MIN) return 'Teraz';
  if (diff < HOUR) {
    const m = Math.floor(diff / MIN);
    return `${m} min temu`;
  }
  // Same calendar day → "Dziś"; previous calendar day → "Wczoraj".
  const day = startOfDay(new Date(now));
  const then = startOfDay(new Date(ts));
  const dayDiff = Math.round((day - then) / DAY);
  if (dayDiff <= 0) {
    if (diff < 6 * HOUR) {
      const h = Math.floor(diff / HOUR);
      return `${h} godz. temu`;
    }
    return 'Dziś';
  }
  if (dayDiff === 1) return 'Wczoraj';
  if (dayDiff < 7) return `${dayDiff} dni temu`;
  // Older → short numeric date (day.month), language-neutral.
  const d = new Date(ts);
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Monochrome initials from the contact name (e.g. "Anna Kowalska" → "AK"). Used
// by the avatar disc so each row has a calm, brand-honest identity mark.
export function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Best display label for a conversation: the local contact label, then the
// peer's learned display name, then the room code.
function labelFor(c) {
  return c.contactName || c.peerDisplayName || c.roomCode || 'Rozmowa';
}

// --- components ------------------------------------------------------------

// Monochrome initials avatar — surfaceStrong disc, ink initials, pill radius.
function Avatar({ name }) {
  return (
    <View style={styles.avatar} importantForAccessibility="no" accessibilityElementsHidden>
      <Text style={styles.avatarText}>{initials(name)}</Text>
    </View>
  );
}

// Unread pill badge — ink fill, onPrimary count. Caps at "99+". Hidden at 0.
function UnreadBadge({ count }) {
  if (!count || count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function ConversationRow({ conversation, onPress, now }) {
  const name = labelFor(conversation);
  const preview = truncatePreview(conversation.lastMessagePreview);
  const time = relativeTime(conversation.lastMessageAt, now);
  const unread = conversation.unreadCount || 0;
  const hasUnread = unread > 0;

  // Compose one spoken label so a screen reader announces the whole row at once,
  // including the unread count — eyes-free is a first-class mode for this app.
  const a11yLabel =
    `Rozmowa z ${name}` +
    (preview ? `. Ostatnia wiadomość: ${preview}` : '. Brak wiadomości') +
    (time ? `. ${time}` : '') +
    (hasUnread ? `. ${unread} nieprzeczytane` : '');

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onPress(conversation)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Otwiera rozmowę"
    >
      <Avatar name={name} />

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text
            style={[styles.name, hasUnread && styles.nameUnread]}
            numberOfLines={1}
          >
            {name}
          </Text>
          {!!time && <Text style={styles.time} numberOfLines={1}>{time}</Text>}
        </View>

        <View style={styles.rowBottom}>
          <Text
            style={[styles.preview, hasUnread && styles.previewUnread]}
            numberOfLines={1}
          >
            {preview || 'Wyślij pierwszą wiadomość…'}
          </Text>
          <UnreadBadge count={unread} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// Empty state — calm, centered, monochrome. Invites the first chat.
function EmptyState({ onNewChat }) {
  return (
    <View style={styles.empty} accessibilityRole="text">
      <Text style={styles.emptyTitle}>Brak rozmów</Text>
      <Text style={styles.emptyText}>
        Zacznij pierwszą rozmowę — dotknij „Nowa rozmowa”, podaj wspólny kod
        pokoju i wybierzcie głosy.
      </Text>
      <TouchableOpacity
        style={styles.emptyCta}
        onPress={onNewChat}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Nowa rozmowa"
        accessibilityHint="Otwiera tworzenie nowej rozmowy"
      >
        <Text style={styles.emptyCtaIcon}>＋</Text>
        <Text style={styles.emptyCtaText}>Nowa rozmowa</Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * @param {object}   props
 * @param {object[]} [props.conversations]      repo.rowToConversation shapes
 * @param {function} props.onOpenConversation   (session) => void — open ChatScreen
 * @param {function} props.onNewChat            () => void — open the new-chat flow
 * @param {function} [props.onSpeak]            () => void — open the "Mów" screen
 * @param {string}   [props.title]              header title (default "Rozmowy")
 */
export default function ConversationsScreen({
  conversations = [],
  onOpenConversation,
  onNewChat,
  onSpeak,
  onVoiceStudio,
  title = 'Rozmowy',
}) {
  // Snapshot "now" once per render so every row's relative time is consistent.
  const now = Date.now();
  const isEmpty = conversations.length === 0;

  // Translate a tapped conversation into the exact props ChatScreen consumes
  // (roomId = roomCode + contact data). The full conversation rides along so a
  // caller can persist/scope without re-deriving it.
  function handleOpen(c) {
    onOpenConversation?.({
      roomId: c.roomCode,
      contactName: labelFor(c),
      contactVoiceId: c.contactVoiceId,
      myVoiceId: c.myVoiceId,
      displayName: c.peerDisplayName || labelFor(c),
      conversation: c,
    });
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />

      {/* Header: canvas, hairline divider, ink title + actions ("Mów" + "+ New chat"). */}
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <View style={styles.headerActions}>
          {onSpeak && (
            <TouchableOpacity
              style={styles.speakBtn}
              onPress={onSpeak}
              activeOpacity={0.7}
              hitSlop={sizes.hitSlop}
              accessibilityRole="button"
              accessibilityLabel="Mów"
              accessibilityHint="Otwiera tryb mówienia z emocjami"
            >
              <Text style={styles.speakBtnText} numberOfLines={1}>Mów</Text>
            </TouchableOpacity>
          )}
          {onVoiceStudio && (
            <TouchableOpacity
              style={styles.speakBtn}
              onPress={onVoiceStudio}
              activeOpacity={0.7}
              hitSlop={sizes.hitSlop}
              accessibilityRole="button"
              accessibilityLabel="Mój głos"
              accessibilityHint="Sklonuj lub ustaw swój głos"
            >
              <Text style={styles.speakBtnText} numberOfLines={1}>🎙</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.newBtn}
            onPress={onNewChat}
            activeOpacity={0.85}
            hitSlop={sizes.hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Nowa rozmowa"
            accessibilityHint="Otwiera tworzenie nowej rozmowy"
          >
            <Text style={styles.newBtnIcon}>＋</Text>
            <Text style={styles.newBtnText} numberOfLines={1}>Nowa</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        style={styles.list}
        contentContainerStyle={[styles.listContent, isEmpty && styles.listContentEmpty]}
        data={conversations}
        keyExtractor={(c) => c.id || c.roomCode}
        renderItem={({ item }) => (
          <ConversationRow conversation={item} onPress={handleOpen} now={now} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={<EmptyState onNewChat={onNewChat} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Light editorial canvas — the same shell language as the rest of the app.
  screen: { flex: 1, backgroundColor: colors.canvas },

  // Header: canvas bg, bottom hairline, ink title on the left + ink pill CTA.
  header: {
    paddingTop: sizes.headerTopPad,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    borderBottomWidth: sizes.hairlineWidth,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.canvas,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { ...type.titleMd, color: colors.ink, flexShrink: 1, paddingRight: spacing.sm },

  // Header actions sit together on the trailing edge: a quiet "Mów" + the CTA.
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },

  // "Mów" — secondary action: outline pill (hairline border, ink text), no fill,
  // so it reads as subordinate to the primary "Nowa rozmowa" CTA.
  speakBtn: {
    borderRadius: radius.pill,
    borderWidth: sizes.hairlineWidth,
    borderColor: colors.hairlineStrong,
    paddingHorizontal: spacing.sm,
    minWidth: sizes.tapMin,
    minHeight: sizes.tapMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakBtnText: { ...type.button, color: colors.ink },

  // "+ New chat" — compact ink pill CTA (brand CTA language, onPrimary text).
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    minHeight: sizes.tapMin,
  },
  newBtnIcon: { color: colors.onPrimary, fontSize: 18, marginRight: spacing.xs, lineHeight: 20 },
  newBtnText: { color: colors.onPrimary, ...type.button },

  list: { flex: 1 },
  listContent: { paddingVertical: spacing.xs, flexGrow: 1 },
  // When empty, let the empty-state center within the available space.
  listContentEmpty: { justifyContent: 'center' },

  // Conversation row — a surface card feel achieved with a bottom hairline
  // separator (flat, brand-honest: hairlines over shadows). Comfortable height.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    minHeight: sizes.tapMin + spacing.base,
    backgroundColor: colors.canvas,
  },
  separator: {
    height: sizes.hairlineWidth,
    backgroundColor: colors.hairline,
    marginLeft: spacing.base + sizes.voiceIcon + spacing.sm, // align under the text, past the avatar
  },

  // Monochrome initials avatar — surfaceStrong disc, ink initials, pill radius.
  avatar: {
    width: sizes.voiceIcon,
    height: sizes.voiceIcon,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  avatarText: { ...type.caption, color: colors.ink, fontFamily: type.bodyStrong.fontFamily },

  rowBody: { flex: 1, justifyContent: 'center' },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xxs },

  name: { ...type.bodyStrong, color: colors.ink, flexShrink: 1, paddingRight: spacing.sm },
  // Unread emphasis stays monochrome — darkest ink, nothing saturated.
  nameUnread: { color: colors.ink },
  time: { ...type.caption, color: colors.mutedSoft },

  preview: { ...type.bodySm, color: colors.muted, flexShrink: 1, paddingRight: spacing.sm },
  previewUnread: { color: colors.body, fontFamily: type.bodyStrong.fontFamily },

  // Unread badge — ink pill, onPrimary count (monochrome, never a hue).
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    paddingHorizontal: sizes.chipPadV + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { ...type.caption, color: colors.onPrimary, fontSize: 12, lineHeight: 14 },

  // Empty state — centered, calm, with the same ink pill CTA.
  empty: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.section },
  emptyTitle: { ...type.displaySm, color: colors.ink, textAlign: 'center', marginBottom: spacing.sm },
  emptyText: { ...type.bodySm, color: colors.muted, textAlign: 'center', marginBottom: spacing.lg },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    minHeight: sizes.ctaHeight,
    paddingHorizontal: spacing.lg,
  },
  emptyCtaIcon: { color: colors.onPrimary, fontSize: 18, marginRight: spacing.sm, lineHeight: 20 },
  emptyCtaText: { color: colors.onPrimary, ...type.button },
});
