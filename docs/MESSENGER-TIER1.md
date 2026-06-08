# VoiceThread — Messenger Tier-1 spec (conversation + message acceptance criteria)

Status: spec / acceptance criteria only (no code). Owner: **spec**.
Scope: the **Tier 1 "Essentials"** items from `docs/MESSENGER-FEATURES.md`, turned
into testable acceptance criteria with the **exact table schemas**, **unread
semantics**, **new-chat entry behavior**, and the **pairing → persistence flow**.

This document is the contract the implementing roles build to. It does **not**
restate the backlog — read `docs/MESSENGER-FEATURES.md` first for the "what/why"
and tier boundaries. It does **not** redesign anything visual — every screen,
component, color, type, spacing and interaction pattern MUST come from
**`docs/ELEVENLABS-BRAND.md`** (the single source of truth for the visual
language). Where this doc says "list row", "badge", "avatar", "empty state",
"header", etc., it means *the brand recipe for that thing* in ELEVENLABS-BRAND.md.

## Pillars this spec must not violate (non-negotiable)
- **Privacy-by-design.** Conversations + messages live **on-device only**
  (`expo-sqlite`). The relay (`server.js`) **stores nothing** and **logs no
  content** — it is a dumb pipe. Nothing in Tier 1 may add server-side storage,
  server-side history, or content logging. (See `SECURITY.md`.)
- **Voice-first.** Every rendered message keeps its existing ▶ play affordance
  (on-device emotion → ElevenLabs TTS via `GET /api/tts`). Tier 1 must not
  regress playback.
- **Milestone-1 must keep working.** The "Mów" (speak-with-emotion) screen and
  its contracts stay intact and keep bundling (Expo Go). Tier-1 work is additive.
- **Expo Go compatible.** Tier 1 uses only Expo-Go-safe modules (`expo-sqlite`).
  No dev-build-only deps (those are Tier 3 — push, etc.).

## What is fixed by the existing code (read before building)
These are the *current* contracts the implementation already relies on. Tier 1
extends them; it must not break them.

- **Relay wire contract** (`server.js`, mirrored in `voicethread-app/src/api/socket.js`):
  `join {roomId,userId,displayName}` · `message <payload>` · `typing {isTyping}` ·
  `delivered {messageId}` · `played {messageId}` · `leave`; inbound `joined` ·
  `peer_joined` · `peer_left` · `message` · `typing` · `delivered` · `played` ·
  `error`. Rooms are **capped at 2 members** (`relay.maxRoomMembers`). The
  pairing **code = roomId**, charset `^[A-Za-z0-9._:-]{1,64}$`.
- **Message payload shape** relayed verbatim today (`useChat.js` `send`):
  `{ id, sender, text, ttsText, voiceId, modelId, voiceSettings, emotion,
  intensity, ts }`. The receiver (`onMessage`) reads `id, sender, text, ttsText,
  voiceId, modelId, voiceSettings, ts` (and may read `emotion`). **Tier 1's
  persisted schema must be a superset of this** so a stored message can be
  re-rendered and re-played identically with no server round-trip for content.
- **Per-message status today:** `'sent' | 'delivered'` (the outgoing tick goes
  `✓` → `✓✓`). Tier 1 adds `'seen'`/read and the corresponding ▶-played state.
- **Current entry behavior (the thing Tier 1 replaces):** `App.js` `ChatSetupScreen`
  collects `code`, `name`, `myVoiceId`, `contactVoiceId`, mints a **fresh
  per-session `userId`** (`u-xxxxxxx`, not persisted) and calls `onJoin(...)` →
  one live `ChatScreen`. There is **no list, no history, no unread, nothing
  survives a reload**. Tier 1 turns this single-shot setup into a persistent,
  multi-conversation messenger.

---

# 1. Data model (on-device SQLite)

Two tables. SQLite has no native boolean/timestamp — use the column types below
and the stated conventions. **All times are integer epoch milliseconds (UTC)**
to match `Date.now()` used everywhere in the app (`ts` in the payload).

> Ownership note: the **schema + migrations + a repository module** are owned by
> **features** (`voicethread-app/src/db/**` per the backlog). This section is the
> *required* shape and constraints; features may add indexes/helpers but must not
> drop a required column or weaken a constraint without a spec change.

## 1.1 `conversations` table

One row per chat (one paired peer). Created when a new chat is started.

| column | type | null? | default | meaning / constraint |
|---|---|---|---|---|
| `id` | TEXT | NOT NULL | — | **Primary key.** Stable local conversation id (e.g. a generated `c-xxxxxxxx`). Do **not** reuse the room code as the PK (codes can repeat/rotate). |
| `room_code` | TEXT | NOT NULL | — | The pairing code (= relay `roomId`). Must match `^[A-Za-z0-9._:-]{1,64}$`. |
| `peer_user_id` | TEXT | NULL | NULL | The peer's relay `userId`, learned from `joined`/`peer_joined`. NULL until the peer has joined at least once. |
| `peer_display_name` | TEXT | NULL | NULL | Peer's display name (from the relay or last message `sender`). Fallback label only; never required to open the chat. |
| `contact_name` | TEXT | NOT NULL | — | The **local** label the user gave this chat (what shows in the list + header). Defaults to `peer_display_name` or the room code if the user didn't type one. |
| `contact_voice_id` | TEXT | NOT NULL | — | ElevenLabs voiceId used to **synthesize the peer's** messages (per-contact voice). Must satisfy the proxy's `^[A-Za-z0-9_-]{1,64}$`. |
| `my_voice_id` | TEXT | NOT NULL | — | voiceId stamped on **our outgoing** messages for this chat (so a peer with no contact configured can still hear us). Same charset. |
| `created_at` | INTEGER | NOT NULL | — | Epoch ms when the conversation was created locally. |
| `last_message_at` | INTEGER | NULL | NULL | Epoch ms of the most recent message in either direction. NULL = no messages yet. **Drives list sort.** |
| `last_message_preview` | TEXT | NULL | NULL | Short plain-text snippet of the last message (the `text`, not `ttsText` with tags). For the list row's secondary line. |
| `unread_count` | INTEGER | NOT NULL | `0` | Number of **incoming** messages not yet seen by the local user. See §2. Never negative. |
| `archived` | INTEGER | NOT NULL | `0` | Boolean as 0/1. Reserved for Tier 2+; Tier 1 always writes `0` and shows only `archived = 0`. |

Constraints / indexes (required):
- `PRIMARY KEY (id)`.
- `UNIQUE (room_code)` — **one conversation per pairing code.** Re-entering an
  existing code MUST resolve to the existing row, not create a duplicate (see §3).
- Index on `last_message_at DESC` (list ordering).
- `unread_count >= 0` enforced by the repo (CHECK optional).

## 1.2 `messages` table

One row per message, incoming or outgoing. **Superset of the relay payload** so a
stored message replays identically offline.

| column | type | null? | default | meaning / constraint |
|---|---|---|---|---|
| `id` | TEXT | NOT NULL | — | **Primary key.** The message id minted at send time (`useChat` `uid()`), or the incoming payload's `id`. Used for dedupe + receipt matching. |
| `conversation_id` | TEXT | NOT NULL | — | **FK → `conversations.id`.** Index this. |
| `mine` | INTEGER | NOT NULL | — | Boolean 0/1. 1 = sent by local user, 0 = received. (`mine` in the in-memory message.) |
| `sender` | TEXT | NULL | NULL | Display name of the sender at send time (peer or self). |
| `text` | TEXT | NOT NULL | `''` | Plain message text (what's shown in the bubble). |
| `tts_text` | TEXT | NULL | NULL | Emotion-tagged text for TTS replay (eleven_v3 tags). If NULL, replay falls back to `text`. |
| `voice_id` | TEXT | NULL | NULL | Sender's own voiceId baked into the payload (replay fallback). |
| `model_id` | TEXT | NULL | NULL | TTS model chosen on-device (`eleven_v3` for emotion, else fallback). |
| `voice_settings` | TEXT | NULL | NULL | JSON string of `{stability,similarity_boost,style,use_speaker_boost}`. Stored serialized; parsed on read. |
| `emotion` | TEXT | NULL | NULL | Detected emotion label (drives the bubble emoji). |
| `intensity` | REAL | NULL | NULL | 0..1 emotion intensity. |
| `ts` | INTEGER | NOT NULL | — | Epoch ms the message was created (payload `ts`). **Drives thread order + date separators.** |
| `status` | TEXT | NOT NULL | `'sent'` | One of `sent` \| `delivered` \| `seen`. Outgoing only meaningfully transitions; incoming rows store `delivered` (or `seen` once the local user has read them). See §2. |
| `played` | INTEGER | NOT NULL | `0` | Boolean 0/1. 1 = the ▶-played receipt applies (peer played our message, or we played theirs). |

Constraints / indexes (required):
- `PRIMARY KEY (id)`.
- `FOREIGN KEY (conversation_id) REFERENCES conversations(id)`.
- Composite index `(conversation_id, ts)` — paginated thread reads + ordering.
- **Idempotent insert:** inserting a row whose `id` already exists is a **no-op**
  (INSERT OR IGNORE). The relay may re-deliver on reconnect; dedupe by `id`.
- `status` ∈ {`sent`,`delivered`,`seen`}; `played` ∈ {0,1}.

### `status` lifecycle (single source of truth)
```
outgoing:  sent ──(relay 'delivered' / peer ack)──▶ delivered ──(peer 'played'/seen)──▶ seen
incoming:  delivered ──(local user opens chat & row is read)──▶ seen
```
Tick UI (already in `ChatScreen` `Bubble`, owned by **ux**): `sent` = `✓`,
`delivered` = `✓✓`, `seen` = `✓✓` styled as "read" (e.g. inked/filled per brand —
**no new accent color**; use ink/muted from ELEVENLABS-BRAND.md). The ▶/❚❚ played
glyph is the existing play control; `played=1` may add a subtle "listened" hint.

---

# 2. Unread semantics (exact rules)

Unread is **per conversation**, computed from **incoming** messages only.

1. **Increment.** When an **incoming** message is persisted **and its conversation
   is not the one currently open on screen**, increment that conversation's
   `unread_count` by 1 (in the same write that inserts the message).
2. **No self-unread.** Outgoing messages (`mine=1`) never affect `unread_count`.
3. **Clear on open.** Opening a conversation (mounting its `ChatScreen`) sets that
   conversation's `unread_count = 0` and marks its still-`delivered` incoming rows
   as `seen` (this is also what fires the `seen` receipt back to the peer). Clearing
   is **immediate on open**, not on scroll-to-bottom (PoC simplicity; matches the
   backlog's "clear on open").
4. **Active-chat suppression.** If a message arrives while its conversation is the
   one already open, it does **not** increment unread and is marked `seen`
   immediately (and a `seen` receipt is sent).
5. **Badge display.** The conversation list shows the per-row unread badge when
   `unread_count > 0` (brand **badge/chip pill** recipe; **monochrome** — ink fill,
   `onPrimary` text — not a saturated color). Show the exact number; cap the
   rendered label at `99+` for counts ≥ 100 (the stored value is uncapped).
6. **Aggregate (optional, Tier-1-friendly).** A total unread across conversations
   (sum of `unread_count`) MAY back a tab/title badge. Not required for Tier 1.
7. **Ordering interaction.** Unread does **not** change list order; order is by
   `last_message_at DESC` (§4). A read chat with a newer message still sorts above
   an unread chat with an older message.

Acceptance checks for unread:
- Sending N messages from the peer to a **closed** chat → that chat's badge shows
  N; opening it → badge clears to 0 and stays 0 on further reads.
- Receiving a message in the **open** chat → no badge ever appears for it.
- App restart preserves `unread_count` (it's persisted), so badges survive reloads.

---

# 3. New-chat entry behavior (replaces the single setup screen)

The default screen becomes the **conversation list** (`ConversationsScreen`),
**not** the setup form. New chats are created via a **"+ New chat"** entry.

> Ownership: list screen + routing are **features** (`ConversationsScreen.js`) and
> **ux** (`App.js` routing/visual shell). The setup *inputs* (code, name, my
> voice, contact voice) already exist in `App.js` `ChatSetupScreen` and are reused
> as the "new chat" form — do not invent a new input set.

### 3.1 "+ New chat" form (reuse existing inputs)
Collects exactly what pairing needs today:
- **Pairing code** (= room code). Required. Validated against
  `^[A-Za-z0-9._:-]{1,64}$` **before** allowing submit (the relay rejects
  otherwise with `bad_room`). Trimmed; `autoCapitalize=none`, `autoCorrect=off`
  (as today).
- **Contact name** → `conversations.contact_name`. Optional input; if blank,
  default to the code (or peer name once known).
- **My display name** → used as relay `displayName` and stamped as `sender`.
  Persist as a profile default (see §5) so the user types it once.
- **My voice** → `my_voice_id`; **Contact voice** → `contact_voice_id`. Picked
  from the shared `/api/voices` list (existing `VoicePicker`). Sensible defaults
  preselected (my = first, contact = second) exactly as today.

Submit ("Połącz" / Start) is enabled only when: connected to backend **AND** a
valid code **AND** both voices chosen (mirrors the current `ready` gate).

### 3.2 Create-or-resume (idempotency)
On submit:
- If a `conversations` row with this `room_code` **already exists** → **resume it**
  (open that conversation, do not create a duplicate, keep its history + unread).
  Optionally update `contact_name`/voices if the user changed them.
- Else → **create** a new `conversations` row: new `id`, store code + names +
  voices, `created_at = now`, `unread_count = 0`, `last_message_at = NULL`.
- Then **navigate into** that conversation's `ChatScreen` (see §4 "open").

### 3.3 Stable device identity (`userId`)
The relay needs a stable per-device `userId`. Today it is minted fresh per session
and **not persisted** (`App.js`: `u-xxxxxxx`). Tier 1 **persists one device id**
(reused for every conversation, every launch) so receipts/presence are consistent
across reloads. Store it with the profile (§5), generate once on first run.
(Charset must satisfy `^[A-Za-z0-9._:-]{1,64}$`.)

### 3.4 Empty state
With zero conversations, the list shows the brand **empty state** (calm, editorial,
on-canvas) with a single primary **"+ New chat"** CTA (ink pill). Copy stays in the
app's existing Polish voice (e.g. "Zacznij nową rozmowę"). Exact copy is **ux**'s.

---

# 4. End-to-end user flow: new chat → pair → list → open → history loaded

This is the canonical Tier-1 flow and the integration acceptance path.

1. **Launch → list.** App opens to `ConversationsScreen`. It reads all
   `conversations` (where `archived=0`) ordered by `last_message_at DESC`
   (NULLs — never-messaged chats — sort by `created_at DESC` after messaged ones).
   First-ever launch → empty state (§3.4).
2. **New chat.** User taps "+ New chat" → the form (§3.1). User enters code +
   name + voices and submits.
3. **Pair (create-or-resume).** App resolves the `conversations` row (§3.2),
   persists it, and **opens** the conversation.
4. **Join the relay.** Opening the conversation mounts `ChatScreen`, which calls
   `relay.join(roomId, { userId, displayName })` using the **persisted device
   `userId`** (§3.3) and the conversation's `room_code`. Relay replies `joined`
   (and `peer_joined` when the other device joins). Presence/typing/connection
   states behave exactly as today (`useChat`).
5. **History loaded.** On open, `ChatScreen` loads this conversation's persisted
   messages from SQLite (ordered by `(conversation_id, ts)`), renders them with
   date separators (Today/Yesterday/date) and per-message ticks/▶ — **before**
   and independent of any relay round-trip (history must show even while offline).
   Pagination: load newest page first; older pages via pull-to-refresh is **Tier
   2**, but the schema/index (`conversation_id, ts`) must already support it.
6. **Live messaging.** Send/receive flows verbatim through the existing relay +
   `useChat`. Every sent **and** received message is **written to SQLite** (the
   superset row, §1.2). Each write also updates the conversation's
   `last_message_at`, `last_message_preview`, and (for incoming-while-closed)
   `unread_count` (§2).
7. **Back to list.** Leaving the chat returns to `ConversationsScreen`, which now
   reflects the updated last-message preview/time and unread badge. The chat the
   user just left shows `unread_count = 0`.
8. **Restart.** Killing and relaunching the app shows the **same** list with the
   **same** history, previews, and unread counts (persistence proof). The relay
   still holds nothing — all of this came from the device.

Privacy invariant across the whole flow: **no message content, history, preview,
or unread count is ever sent to or stored by `server.js`.** The relay only ever
sees transient `message`/`typing`/`delivered`/`played` frames it forgets, plus the
transient `ttsText` sent to `GET /api/tts` for synthesis.

---

# 5. Settings / profile (Tier-1 item) — minimum required fields

Backed on-device (a small profile store; may be a 1-row table or key-value, owner
**features**). Tier-1 required fields:
- **Display name** (default `sender`/relay `displayName`; editable).
- **My default voice** (preselected as `my_voice_id` for new chats).
- **Device id** (the persisted `userId`, §3.3; shown read-only, not editable).
- **Theme** (light/dark) — **light is the default** per ELEVENLABS-BRAND.md; dark
  tokens exist for the flip. Persist the choice.
- **Privacy disclosure** (static copy: "messages live only on this device; the
  relay stores nothing" — aligns with `SECURITY.md`).
- **Driving-mode defaults** (eyes-free auto-read toggle) — copy/behavior owned by
  **ux**/**voice**; spec only requires the toggle persists.

Screen + copy are **ux** (`SettingsScreen.js` / `UX.md`); the persistence shape is
**features**.

---

# 6. Acceptance criteria per Tier-1 item → code ownership

Each item is **done** only when every check passes. "Owner" = the role that owns
the files; **spec** owns none of these files (this doc is notes only).

### T1.1 Conversation list — owner: **features** (`src/features/chat/ConversationsScreen.js`) + **ux** (`App.js` routing/visual)
- [ ] App's default screen is the conversation list (replaces single setup screen).
- [ ] Each row shows: contact name, last-message preview, last-message time, and an
      unread badge when `unread_count > 0` — all per ELEVENLABS-BRAND.md recipes
      (list row, monochrome badge, Inter type).
- [ ] Rows sorted by `last_message_at DESC` (never-messaged after messaged, by
      `created_at DESC`).
- [ ] "+ New chat" entry is present and reachable from the list (and from the empty
      state).
- [ ] Tapping a row opens that conversation (§4 open).
- [ ] Empty state renders when there are no conversations (§3.4).

### T1.2 Local message history (persistent) — owner: **features** (`src/db/**`, `useChat` read/write)
- [ ] `conversations` + `messages` tables exist with the columns/constraints in §1.
- [ ] Every sent and received message is persisted as the superset row (§1.2).
- [ ] Opening a conversation loads its history from SQLite, ordered by `(conversation_id, ts)`, and renders before/independent of any relay round-trip.
- [ ] History, previews, and unread survive an app restart.
- [ ] Inserts are idempotent by message `id` (no duplicates on relay re-delivery).
- [ ] **Nothing** is written to or read from the server for history (privacy).

### T1.3 Timestamps + date separators — owner: **features**/**ux** (`ChatScreen.js`)
- [ ] Each message shows a per-message time derived from `ts`.
- [ ] The thread shows Today / Yesterday / explicit-date separators between day
      groups, styled per brand (overline/caption, hairline).

### T1.4 Delivered + Seen receipts — owner: **security** (`server.js` relay) + **features** (`useChat`) + **ux** (`ChatScreen` ticks)
- [ ] Status lifecycle matches §1.2: outgoing `sent → delivered → seen`; incoming
      `delivered → seen` on open.
- [ ] Relay carries a read/`seen` signal (extend existing `delivered`/add `seen`
      semantics) **without** storing or logging content — relay stays a dumb pipe.
- [ ] Tick UI: `✓` (sent), `✓✓` (delivered), `✓✓`-read (seen) — **monochrome**
      (ink/muted), no new accent color.
- [ ] The ▶-played receipt (`played`) is preserved (peer played our message).

### T1.5 Typing + presence — owner: **features** (`useChat`) + **ux** (`ChatScreen` header)
- [ ] Existing typing indicator + peer presence keep working.
- [ ] Header conveys connection (online/connecting/offline) as today, plus
      "online / last seen" wording when presence is known (copy = **ux**).
- [ ] No regression to the existing `typing`/`peer_joined`/`peer_left` handling.

### T1.6 Avatars — owner: **ux** (`src/ui/Avatar.js`)
- [ ] Monochrome initials avatar per contact, derived from `contact_name`.
- [ ] Used in the list rows (and optionally the chat header), per brand
      (surfaceStrong circle, ink initials, pill radius). No photos, no color.

### T1.7 Unread counts — owner: **features** (`src/db/**` + list)
- [ ] `unread_count` maintained exactly per §2 (increment on incoming-while-closed,
      no self-unread, clear on open, active-chat suppression).
- [ ] Badge shows the count (`99+` cap on the label only) and clears on open.
- [ ] Survives restart.

### T1.8 Settings / profile — owner: **features** (persistence) + **ux** (`SettingsScreen.js`, `UX.md`)
- [ ] Required fields persist: display name, default voice, device id (read-only),
      theme (light default), driving-mode toggle (§5).
- [ ] Privacy disclosure copy present and consistent with `SECURITY.md`.
- [ ] Theme choice is applied app-wide using ELEVENLABS-BRAND.md tokens.

### Cross-cutting acceptance (every item)
- [ ] Milestone-1 "Mów" screen still bundles and works unchanged.
- [ ] Expo Go compatibility preserved (no dev-build-only deps in Tier 1).
- [ ] All visual/interaction details trace to `docs/ELEVENLABS-BRAND.md`.
- [ ] `server.js` stores/logs no message content; on-device data never leaves the
      device (verifiable: relay code reads only `id` for acks).
- [ ] Zero-credit tests added/extended in `tests/**` where logic is testable
      (schema/repo unit tests, unread arithmetic, status-lifecycle reducer) —
      owner **qa**; no live ElevenLabs/relay credits consumed.

---

# 7. Non-goals (explicitly out of Tier 1)
- Group chats, image/file attachments, push notifications, calls (**Tier 3** in
  `docs/MESSENGER-FEATURES.md` — opt-in, architecture-changing).
- Message actions, reactions, voice-message recording, in-conversation search,
  pull-to-refresh pagination (**Tier 2**; Tier 1 only guarantees the **schema +
  index** that make them cheap to add).
- Any server-side persistence, server-side search, or content logging — **ever**.
- Multi-account / multi-device sync of history (history is single-device by design).

# 8. Open questions for teammates (none blocking this doc)
These are implementation choices the owning roles decide; listed so they aren't
forgotten. They do **not** block Tier-1 acceptance as written.
- **security/features:** exact wire shape for the `seen` receipt — reuse the
  existing `delivered` event with a state flag, or add a dedicated `seen` event?
  (Either is fine if the relay still stores/logs nothing.)
- **features:** profile store as a 1-row SQLite table vs. a small key-value
  (`AsyncStorage`/`expo-sqlite`)? Spec only requires the fields persist.
- **ux:** visual treatment that distinguishes `delivered` vs `seen` ticks within
  the monochrome palette (weight/fill, not color).
