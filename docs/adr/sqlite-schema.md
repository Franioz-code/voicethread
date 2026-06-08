# ADR-0001 — On-device SQLite: schema, identity, dedup, unread & repository pattern

- **Status:** Accepted (Tier-1) — cross-role open items now closed: `seen` wire
  shape signed off by `security`, repo interface + profile store confirmed by
  `features` (see §9/D6, §8, §11).
- **Date:** 2026-06-08
- **Owner of this note:** `architect` (ADR notes only — no code)
- **Implements:** `docs/MESSENGER-TIER1.md` §1–§5 (the authoritative *contract* for
  columns, unread rules and the pairing→persistence flow).
- **Supersedes / depends on:** the relay wire contract in `server.js` and
  `voicethread-app/src/api/socket.js`; the in-memory message shape in
  `voicethread-app/src/features/chat/useChat.js`.
- **Files this enables (owned by `features`, NOT by this ADR):**
  `voicethread-app/src/db/**` (schema + migrations + repository),
  `voicethread-app/src/features/chat/**` (wiring into `useChat`/screens).

> Scope of this ADR: the **architectural decisions** behind the Tier-1 data layer —
> conversation identity, message de-duplication, unread-badge logic, foreign-key
> constraints, the relay-event → DB-write mapping (and its race analysis),
> transaction boundaries, and the **repository interface** `features` will call.
> It does **not** re-specify column types — `MESSENGER-TIER1.md` §1 already fixes
> those and remains the source of truth. Where this ADR and the spec could drift,
> the spec wins on *shape*; this ADR owns *rationale + interface + concurrency*.

---

## 1. Context & forces

VoiceThread is a 1:1 voice-first messenger PoC. The relay (`server.js`) is a **dumb
pipe**: it relays `message`/`typing`/`delivered`/`played` frames between ≤2 members of
a room and **stores nothing, logs no content** (`SECURITY.md`). Therefore *all*
durable state — conversations, message history, unread counts, receipts — must live
**on the device** (`expo-sqlite`, Expo-Go-safe). A stored message must replay
identically with **no server round-trip for content**, so the persisted row is a
**superset of the relay payload**.

Constraints shaping every decision below:

1. **Privacy-by-design.** Nothing here may add server storage or content logging.
   The DB is local; the device id and history never leave the phone.
2. **Idempotency under reconnect.** The relay re-`join`s on every reconnect
   (`useChat.js` `onPeer 'connected'` → `relay.join(...)`) and may re-deliver a
   `message`. Writes must be safe to apply more than once.
3. **No stale-closure races.** `useChat` already uses a reducer specifically to
   avoid stale closures across relay callbacks. The DB layer must not reintroduce
   read-modify-write races for counters (unread) that several callbacks touch.
4. **Single writer, but concurrent callers.** One JS thread, one SQLite file, but
   many async entry points (send, onMessage, delivered/played acks, open/close,
   list refresh). SQLite serialises writes; we still need **explicit transactions**
   so multi-row updates are atomic and observers never see half-states.
5. **Milestone-1 must keep working.** This is purely additive; the "Mów" screen and
   the relay contract are untouched.

---

## 2. Decision summary (the five asks, answered)

| # | Question | Decision |
|---|---|---|
| D1 | **Conversation identity** | Local surrogate PK `id` = generated `c-<rand>` (opaque). `room_code` (= relay `roomId`) is a **separate UNIQUE** column, *not* the PK. "Create-or-resume" keys on `room_code`. |
| D2 | **Message identity / dedup** | PK = the payload `id` minted by `useChat` `uid()`. Dedup = **`INSERT OR IGNORE` by `id`** (idempotent insert). Receipts (`delivered`/`played`/`seen`) are **idempotent UPDATEs** that only ever advance state. |
| D3 | **Unread badge** | Per-conversation `unread_count`, **incremented in the same transaction that inserts an incoming-while-closed message**; **cleared to 0 on open** (with `delivered→seen` flip of that conversation's incoming rows). Maintained by the repo, never by ad-hoc UI math. |
| D4 | **Foreign keys** | `messages.conversation_id → conversations.id`, `ON DELETE CASCADE`. `PRAGMA foreign_keys = ON` per connection. Insert order (conversation first) is guaranteed by the repo. |
| D5 | **Relay→DB mapping / races** | Each relay event maps to exactly one idempotent repo mutation (table in §7). Counters move only inside transactions; receipts are monotonic; out-of-order/duplicate frames are absorbed by idempotency. No read-modify-write on `unread_count` outside a transaction. |
| D6 | **`seen` receipt wire shape** | **Dedicated id-only `seen {messageId}` relay event** (mirrors `delivered`/`played`), *not* reusing `played`. Signed off by `security`, confirmed by `features`. `markSeen` targets this event; receipts are fired device-locally from the read decision (§9). |

Two **tables only** (`conversations`, `messages`) plus a tiny **profile** store
(§8). No third "receipts" table — receipt state lives on the `messages` row
(`status`, `played`) because it is 1:1 with a message and never queried
independently in Tier 1.

---

## 3. D1 — Conversation identity (id vs. room code)

**Decision.** `conversations.id` is an **opaque local surrogate key** (`c-` + base36
random, e.g. `c-2f9k1a7q`), generated once at create time. The pairing code is stored
separately as `room_code` with a **`UNIQUE` constraint**.

**Why not use the room code as the PK?**
- The room code is **user-supplied and reusable/rotatable** (charset
  `^[A-Za-z0-9._:-]{1,64}$`). Two people could pick the same code at different times;
  a code could be re-paired to a different peer later. Binding the PK (and all
  message FKs) to a value that can semantically change couples history to a mutable
  external token.
- A surrogate PK lets Tier 2+ evolve identity (e.g. rename/rekey a chat, or attach a
  second room code) without rewriting `messages.conversation_id`.

**Idempotent pairing ("create-or-resume", spec §3.2).** `UNIQUE (room_code)` makes
"one conversation per pairing code" a *database* invariant, not just app logic.
`getOrCreateConversation` (see §6) does an upsert keyed on `room_code` inside one
transaction:
- row exists → return it (resume; optionally refresh `contact_name`/voice ids);
- else → `INSERT` a new row with a fresh `id`.

This survives the classic double-submit / two-tabs race: even if two calls race, the
`UNIQUE` constraint forces one to lose and re-read the winner's row, so we never get
duplicate conversations for a code.

**Peer identity is informational, not identity.** `peer_user_id` /
`peer_display_name` are learned from `joined`/`peer_joined` and are **nullable**; the
chat must open and render history even before the peer is known (offline-first). They
are never part of any key.

---

## 4. D2 — Message identity & de-duplication

**Decision.** `messages.id` (PK) is the message id already present in the payload —
minted by the sender's `useChat` `uid()` (`<base36 time>-<rand>`) and carried verbatim
through the relay. The receiver persists the **incoming payload's `id`**, not a new
one. This single id is the join point for **both** dedup and receipt matching.

**De-dup strategy: idempotent insert (`INSERT OR IGNORE`).**
- The relay re-delivers on reconnect and the local sender also persists its own
  outgoing copy; in both directions a row with that `id` may already exist.
- `INSERT OR IGNORE` (SQLite "OR IGNORE" conflict clause on the PK) makes a
  re-insert a **no-op**. We then branch on `changes()` (rows actually inserted):
  - `changes() === 1` → it was new → run the side effects (bump
    `last_message_at`/preview, and for incoming-while-closed bump `unread_count`),
    **all in the same transaction** (§7).
  - `changes() === 0` → duplicate → **do nothing else** (critically: do **not**
    re-increment `unread_count`). This is the property that makes reconnect-storms
    safe.

**Why id-based and not content-hash dedup?** Ids are already globally unique per
message and stable across the wire; hashing text would (a) false-merge two genuinely
identical messages and (b) cost more. Id dedup is exact and cheap.

**Receipts are idempotent, monotonic UPDATEs (not inserts).** `delivered`/`played`/
`seen` for a message id are `UPDATE messages SET ... WHERE id = ?`. They:
- **only advance** status along `sent → delivered → seen` (an update guarded by a
  rank check never regresses, so a late `delivered` after `seen` is ignored);
- set `played = 1` once and leave it (idempotent);
- are **safe if the row doesn't exist yet** — the `UPDATE` simply matches 0 rows.
  See the race note in §7 for the (benign) ordering where an ack precedes its row.

---

## 5. D3 — Unread badge logic (mark on receive, clear on open)

Authoritative rules are `MESSENGER-TIER1.md` §2; this ADR fixes **where** the count
is mutated and **why it can't drift**.

**Invariant.** `unread_count` is a **derived-but-materialised** per-conversation
counter over *incoming, unseen* messages, and it is **only ever changed by the repo
inside a transaction tied to the event that justifies the change**. UI code never
writes it; UI only reads it (so two screens can't disagree).

**Increment (on receive).** When an **incoming** message (`mine=0`) is *newly*
inserted (`changes()===1`) **and** its conversation is **not the one open on screen**:
`unread_count = unread_count + 1` **in the same transaction as the insert** (§7,
`addIncomingMessage`). Because the increment is bound to a *new* insert, duplicate
re-deliveries (which IGNORE) cannot inflate it.

**No self-unread.** Outgoing rows (`mine=1`) never touch `unread_count`.

**Active-chat suppression.** Whether a conversation is "open" is decided by the
**caller** (the screen knows which `conversation_id` is mounted) and passed to the
repo as `isOpen`/`activeConversationId`. If the incoming message belongs to the open
chat: insert it as `seen`, do **not** increment, and the caller fires a `seen` receipt
(§9). This keeps the "open chat never badges" rule a pure function of one boolean the
UI already owns — no timing guesswork in the repo.

**Clear on open.** `markConversationRead(conversationId)` runs one transaction:
1. `UPDATE conversations SET unread_count = 0 WHERE id = ?`
2. `UPDATE messages SET status = 'seen' WHERE conversation_id = ? AND mine = 0 AND status = 'delivered'`
   and returns the set of message ids it flipped, so the caller can emit `seen`
   receipts for exactly those (§9). Clearing is **immediate on open**, not on
   scroll (PoC simplicity; matches the backlog).

**Never negative.** Repo guarantees `unread_count >= 0`. Clearing sets it to a
literal `0` (not a decrement), so it cannot underflow even if an increment was
somehow missed. A `CHECK (unread_count >= 0)` is permitted as defence-in-depth.

**Badge & ordering.** Badge renders when `unread_count > 0` (label capped `99+`, value
uncapped). Unread does **not** affect list order — order is `last_message_at DESC`
(NULLs/never-messaged after messaged, by `created_at DESC`). Persisted, so badges
survive restart.

---

## 6. D4 — Foreign-key constraints & integrity

**Decision.**
- `messages.conversation_id` is `NOT NULL` and
  `REFERENCES conversations(id) ON DELETE CASCADE`.
- **`PRAGMA foreign_keys = ON`** is set **once per connection at open** (SQLite
  defaults FKs *off*; `expo-sqlite` requires us to enable it explicitly). The schema
  bootstrap must run this before any write.
- `conversations`: `PRIMARY KEY (id)`, `UNIQUE (room_code)`.
- `messages`: `PRIMARY KEY (id)`, the FK above.

**Why CASCADE.** A future "delete conversation" (Tier 2) should atomically remove its
messages; CASCADE makes that a single statement and prevents orphan rows. In Tier 1
nothing deletes a conversation, so CASCADE is latent but correct to declare now.

**Insert-order guarantee.** Because messages reference a conversation, the repo
**always** resolves/creates the conversation *first* (the chat is opened via
`getOrCreateConversation` before any message write), so a message insert can never
fail the FK. Any message-write API also accepts a `conversationId` the caller already
holds from open; the repo does not invent conversations on message insert.

**Indexes (required, for fast queries).**
| Index | Columns | Serves |
|---|---|---|
| (implicit) PK | `conversations(id)` | row lookup by id |
| `UNIQUE` | `conversations(room_code)` | create-or-resume; **fast lookup by roomId** |
| `idx_conversations_last_msg` | `conversations(last_message_at DESC)` | conversation-list ordering |
| (implicit) PK | `messages(id)` | dedup + receipt matching by id |
| `idx_messages_convo_ts` | `messages(conversation_id, ts)` | **per-conversation** thread reads, ordering, date separators, future pagination |
| `idx_messages_convo_unread` (optional) | `messages(conversation_id, mine, status)` | the `markConversationRead` flip / unread recount |

The composite `(conversation_id, ts)` is the workhorse: it makes "load this chat's
history oldest→newest" and "load newest page first" index-only range scans, and it is
the index Tier-2 pagination will reuse unchanged. The `UNIQUE(room_code)` doubles as
the **roomId fast-path** the spec asks for; conversation rows are few, and message
fan-out is by `conversation_id`, so a dedicated `userId` index is unnecessary in
Tier 1 (peer id is informational, never a query key) — noted here so the omission is
deliberate, not an oversight.

---

## 7. D5 — Relay events → DB writes (mapping + transaction boundaries + race analysis)

### 7.1 Event → mutation map

Today (`useChat.js`) every relay callback mutates **only** the in-memory reducer.
Tier 1 adds a **persist-then-render** (or render-then-persist; see §7.4) step. The
mapping is 1 relay event → 1 idempotent repo mutation:

| Source | Relay event (`socket.js`) | Repo mutation | Atomic unit (transaction) |
|---|---|---|---|
| local send | *(none — local action)* `send()` | `addOutgoingMessage` (insert `mine=1, status='sent'`; bump `last_message_at`/preview) | 1 txn: insert + conversation summary |
| inbound | `message` (peer→us) | `addIncomingMessage` (INSERT OR IGNORE `mine=0`; if new: bump summary; if new **and** not open: `unread_count += 1`; if open: status `seen`) | **1 txn**: insert + summary + counter |
| inbound | `delivered {messageId}` (peer-ack **or** server-ack `by:'server'`) | `markDelivered(id)` (advance `sent→delivered`) | single-row idempotent UPDATE |
| inbound | `played {messageId, by}` | `markPlayed(id)` (`played=1`; the voice-first "listened" hint, **distinct** from `seen` — see §9) | single-row idempotent UPDATE |
| inbound | `seen {messageId, by}` *(**NEW** — finalized in §9; relay handler mirrors `delivered`/`played`)* | `markSeen(id)` (advance `delivered→seen`) | single-row idempotent UPDATE |
| local open | *(screen mount)* | `markConversationRead(conversationId)` | **1 txn**: zero counter + flip incoming `delivered→seen` |
| inbound | `joined` / `peer_joined` | `updatePeerIdentity(conversationId,{peerUserId,peerDisplayName})` | single-row UPDATE (informational) |
| inbound | `typing` / `peer_left` / `error` / connection | *no DB write* (ephemeral presence) | — |

> Note the **two sources of `delivered`**: `server.js` emits `delivered {by:'server'}`
> to the sender immediately on relay (line ~526), and the peer may also emit
> `delivered` (line ~535). Both map to the **same** idempotent `markDelivered` — the
> second is a no-op because status is already ≥ delivered. This is by design and the
> reason receipt updates are monotonic.

### 7.2 Transaction boundaries (the rule)

A write is wrapped in a transaction **iff it touches more than one row/table and those
rows must move together.** Concretely:

- **`addIncomingMessage` — transactional (required).** Insert the message **and**
  update `conversations.last_message_at/last_message_preview` **and** conditionally
  `unread_count` as **one** unit. If any step fails, none apply, so the counter can
  never drift from the rows it counts, and the list never shows a preview/time for a
  message that didn't persist.
- **`addOutgoingMessage` — transactional.** Insert + conversation summary together
  (so a sent bubble and the list preview agree).
- **`markConversationRead` — transactional (required).** Zeroing the counter and
  flipping `delivered→seen` rows must be atomic; otherwise a crash between them leaves
  "0 unread but rows still `delivered`," which would re-badge on the next recount.
- **Single-row receipt updates — no explicit transaction needed.** `markDelivered`,
  `markPlayed`, `markSeen`, `updatePeerIdentity` are one statement each; SQLite's
  implicit statement-level atomicity suffices.
- **Schema bootstrap/migrations — transactional**, behind `user_version` (§10).

Counter mutations (`unread_count`) **only** ever happen *inside* `addIncomingMessage`
or `markConversationRead`. There is no public "setUnread"/"incrementUnread" — removing
the ability to do read-modify-write from the UI is what makes the counter race-free.

### 7.3 Concurrency model & why there are no lost updates

- **One JS thread + one SQLite file.** All repo calls execute on the single RN JS
  thread; SQLite serialises the actual writes. The only real hazard is a
  **read-modify-write** counter updated from multiple async callbacks. We eliminate
  it by doing the read-modify-write **inside SQL** (`unread_count = unread_count + 1`
  / `= 0`) within a transaction, never as JS `read → compute → write`.
- **Idempotency covers the wire.** Reconnect re-`join` + possible `message`
  re-delivery are absorbed by `INSERT OR IGNORE` + monotonic UPDATEs (§4). Duplicate
  `delivered`/`played` frames are no-ops.
- **Ordering independence.** Because each event maps to an *idempotent, commutative-
  enough* mutation (advance-only status, set-once `played`, +1-on-new-insert), the
  end state does not depend on the arrival order of `delivered` vs `played` vs a
  re-delivered `message`.

### 7.4 The one genuine ordering race, and its (benign) resolution

**Race:** a `delivered`/`played` ack for message `X` could arrive *before* `X`'s row
is committed — e.g. on the **sender** side, the server-ack `delivered {by:'server'}`
is emitted the instant the relay forwards `X`, which can land before/while the sender
persists its own outgoing copy of `X`. Symmetrically a re-delivered `message` could
interleave with a receipt.

**Resolution (no locks, no buffering):**
1. **Persist before (or synchronously with) emitting/acking.** The sender writes its
   outgoing row (`addOutgoingMessage`) *before* `relay.sendMessage`, so by the time
   any ack returns, the row exists. (Matches the existing optimistic-add in
   `useChat.send`, just adding the DB write in front of the emit.)
2. **Receipt UPDATEs are safe on a missing row.** If despite (1) an ack still
   precedes the row, `UPDATE ... WHERE id = ?` matches 0 rows — harmless. The status
   the row is later inserted with is its correct *initial* status; the lost ack only
   meant we display `sent` a moment longer until the next event or open. For the
   voice-first PoC this transient is acceptable and self-heals (a subsequent
   `played`/open advances it).
3. **Never resurrect rows from a receipt.** A receipt must **not** `INSERT` a
   placeholder message — that would create a content-less ghost and risk a duplicate
   when the real `message` arrives. Receipts only `UPDATE`. This keeps dedup honest.

This is the deliberate trade: **idempotent, order-independent mutations + persist-
before-emit** instead of a sequencer/outbox. It is correct for ≤2 members and zero
server state, and it is the minimal design that satisfies "no race conditions" without
adding infrastructure the PoC doesn't need.

---

## 8. Profile store (device identity & settings) — D-aux

Tier-1 settings (`MESSENGER-TIER1.md` §5) need a tiny durable store. **Decision
(confirmed by `features`): a 1-row `profile` table in the same SQLite database** (not
a second storage engine like `AsyncStorage`) so identity + settings share one
transactional, single-file store and one backup/migration path — avoiding a split
where a reinstall/restore could wipe one engine but not the other (e.g. losing the
stable device id while keeping history, or vice-versa). The repo surface is identical
whichever engine backs it, so this is purely an implementation choice and `features`
adopted SQLite for the single-store benefit.

`profile` (single row, `id = 'me'` sentinel):
- `device_user_id` TEXT NOT NULL — the **persisted, stable relay `userId`** (§ below).
- `display_name` TEXT — default `sender`/relay `displayName`.
- `default_voice_id` TEXT — preselected `my_voice_id` for new chats.
- `theme` TEXT — `'light' | 'dark'`, default `'light'`.
- `driving_mode` INTEGER — 0/1 eyes-free auto-read default.

**Stable device id (replaces per-session `userId`).** Today `App.js` mints
`u-xxxxxxx` per session and never persists it; `useChat` joins with that transient id.
Tier 1 **generates the device id once on first run** and stores it in `profile`, then
every conversation/launch reuses it (charset `^[A-Za-z0-9._:-]{1,64}$`). This is what
makes receipts/presence consistent across reloads. The id is shown read-only in
Settings; it never leaves the device except as the relay `userId` handshake (which the
relay already forgets).

`getProfile()` / `updateProfile(patch)` / `ensureDeviceId()` are part of the repo
surface (§6 table).

---

## 9. The `seen` receipt wire shape — **DECIDED: dedicated `seen` event (Option B)**

The DB was already ready for `seen` (status enum includes it; `markSeen` +
`markConversationRead` flip it). The remaining open question was the **relay wire
shape**, owned by `security` (`server.js`) and `features` (client emit/ack). Today
the relay has `delivered` and `played` but **no `seen`**.

**Decision (signed off by `security`, confirmed integrable by `features`):** add a
**dedicated, id-only `seen {messageId}` event** mirroring `delivered`/`played` —
*not* reusing `played`.

**Why a dedicated event over reusing `played`:**
- **Semantic clarity.** In a voice-first messenger `played` ("started audio
  playback") and `seen` ("opened the chat / confirmed read") are genuinely different
  signals. Conflating them works for a voice-only PoC but breaks forward
  compatibility the moment text-first reading matters (a peer can read without
  playing, and play without it being a "read"). Keeping them separate preserves the
  3-tier receipt model `transport (delivered) → playback (played) → read (seen)`.
- **Symmetry & minimal diff.** It is one ~4-line `socket.on('seen', …)` re-emit in
  `server.js` (after the `played` handler, ~line 545) that exactly mirrors the
  existing `delivered`/`played` handlers, plus one client listener + one emit helper
  in `socket.js`. The relay stays a **dumb pipe**: id-only, bounds-checked via the
  existing `asBoundedString(messageId, maxMessageIdLen)`, no content, no logs, no
  storage.

**Finalized wire contract (owned by `security`+`features`, recorded here so the repo
targets the real event):**
```
relay (server.js, after the 'played' handler):
  socket.on('seen', ({ messageId } = {}) => {
    const roomId = socket.data?.roomId; if (!roomId) return;
    socket.to(roomId).emit('seen',
      { messageId: asBoundedString(messageId, CONFIG.relay.maxMessageIdLen),
        by: socket.data.userId });
  });

client (socket.js):
  emit  seen { messageId }          // export function seen(messageId)
  recv  seen { messageId, by }      // -> useChat dispatch -> repo.markSeen(id)
```

**Repo consequence (already reflected in §7.1 and §11):** `repo.markSeen(id)` is now
wired to **this** event. The receipt is emitted **device-locally from the read
decision** — i.e. `markConversationRead` (§5) returns the ids it flipped
`delivered→seen`, and the caller fires one `relay.seen(id)` per id (and likewise the
active-chat-suppression path in `addIncomingMessage` emits `seen` for the single
just-read incoming message). This keeps the DB the source of truth for *which* ids
became read, and the relay merely forwards the notification.

**Idempotency/privacy properties (unchanged by this choice):** calling `seen` twice
for an id is benign (`markSeen` is a monotonic `delivered→seen` UPDATE, no-op if
already `seen` or row absent); the relay forgets the frame; the decision to emit is
device-local. This satisfies the spec's "relay carries a read/`seen` signal without
storing or logging content" (`MESSENGER-TIER1.md` T1.4) with the relay still reading
only the `id`.

---

## 10. Migrations & bootstrap

- Versioned via SQLite **`PRAGMA user_version`** (start at `1`). Bootstrap, in one
  transaction: set `foreign_keys = ON`, `CREATE TABLE IF NOT EXISTS` for
  `conversations`, `messages`, `profile`, create the indexes in §6, seed the single
  `profile` row + device id if absent, then bump `user_version`.
- Forward-only migrations for Tier 2 (reactions, attachments, search) add tables/
  columns guarded by `user_version` steps — they must not drop/rename a Tier-1
  column or weaken a constraint without a spec change (`MESSENGER-TIER1.md` §1 note).
- Bootstrap is **idempotent** (`IF NOT EXISTS` everywhere) so a re-run on an existing
  DB is a no-op.

---

## 11. Repository interface (the contract `features` implements & calls)

A single module (`voicethread-app/src/db/repo.js`, owner `features`) exposes the
functions below. **All times are integer epoch ms (UTC)** to match `Date.now()`/the
payload `ts`. Booleans are 0/1. `voice_settings` is stored as a JSON string and
parsed on read. **No SQL leaks past this module** — screens/`useChat` call these,
never raw queries — which is what lets the repo own every counter/transaction
invariant above.

### 11.1 Lifecycle
```
init(): Promise<void>
  // Open DB, PRAGMA foreign_keys=ON, run bootstrap/migrations (§10), ensure
  // profile row + device id. Safe to call once at app start; idempotent.
```

### 11.2 Profile (§8)
```
getProfile(): Promise<Profile>
  // { deviceUserId, displayName, defaultVoiceId, theme, drivingMode }
updateProfile(patch): Promise<Profile>
  // Partial update of display_name/default_voice_id/theme/driving_mode.
ensureDeviceId(): Promise<string>
  // Return persisted device userId; generate+persist once on first run.
```

### 11.3 Conversations — queries
```
getConversations(): Promise<Conversation[]>
  // archived=0, ordered last_message_at DESC, NULLs (never-messaged) last by
  // created_at DESC. Powers ConversationsScreen. Includes unread_count.
getConversation(id): Promise<Conversation | null>
getConversationByRoomCode(roomCode): Promise<Conversation | null>
getTotalUnread(): Promise<number>          // optional aggregate for a tab badge
```

### 11.4 Conversations — mutations
```
getOrCreateConversation({ roomCode, contactName, contactVoiceId,
                          myVoiceId, displayName }): Promise<Conversation>
  // Create-or-resume (D1/§3.2), keyed on UNIQUE(room_code), in one txn.
  // Existing row -> returned (and contact_name/voice ids refreshed if changed);
  // else inserted with new id, created_at=now, unread_count=0,
  // last_message_at=NULL. NEVER creates a duplicate for a code.
updatePeerIdentity(conversationId, { peerUserId, peerDisplayName }): Promise<void>
  // From joined/peer_joined. Informational; nullable; never a key.
markConversationRead(conversationId): Promise<string[]>
  // CLEAR ON OPEN (§5), one txn: unread_count=0 AND flip this conv's incoming
  // status delivered->seen. Returns the ids it flipped so the caller can emit
  // seen receipts for exactly those.
```

### 11.5 Messages — queries
```
getMessages(conversationId, { limit?, beforeTs? }): Promise<Message[]>
  // Thread read via idx (conversation_id, ts). Default newest page first;
  // beforeTs enables Tier-2 "load older" with no schema change. Parses
  // voice_settings JSON; returns the superset row ready to render & replay.
getMessageById(id): Promise<Message | null>   // dedup/receipt helper
```

### 11.6 Messages — mutations
```
addOutgoingMessage(conversationId, payload): Promise<Message>
  // INSERT mine=1 status='sent' (one txn with conversation summary bump).
  // Call BEFORE relay.sendMessage (persist-before-emit, §7.4). Idempotent by id.

addIncomingMessage(conversationId, payload, { isOpen }): Promise<{
  inserted: boolean, message: Message }>
  // INSERT OR IGNORE mine=0 (dedup, D2). If newly inserted (one txn):
  //   - bump last_message_at/last_message_preview;
  //   - if !isOpen: unread_count += 1, status='delivered';
  //   - if  isOpen: status='seen' (active-chat suppression, caller emits seen).
  // If duplicate (inserted=false): NO side effects (no unread bump). §5/§7.

markDelivered(messageId): Promise<void>
  // Advance sent->delivered (monotonic; no-op if already >=delivered or row
  // absent). Handles BOTH server-ack and peer-ack 'delivered' (§7.1).
markPlayed(messageId): Promise<void>
  // Set played=1 (idempotent). Voice-first "listened" hint ONLY; does NOT advance
  // status to seen (seen is a separate signal, §9/D6). On peer 'played'.
markSeen(messageId): Promise<void>
  // Advance delivered->seen (monotonic; no-op if already seen or row absent).
  // Wired to the dedicated 'seen' relay event (§9/D6). On peer 'seen'.
```

### 11.7 Types (shape, not types-the-language)
```
Conversation = { id, roomCode, peerUserId?, peerDisplayName?, contactName,
  contactVoiceId, myVoiceId, createdAt, lastMessageAt?, lastMessagePreview?,
  unreadCount, archived }
Message = { id, conversationId, mine, sender?, text, ttsText?, voiceId?,
  modelId?, voiceSettings?, emotion?, intensity?, ts, status, played }
Profile = { deviceUserId, displayName?, defaultVoiceId?, theme, drivingMode }
```

### 11.8 Wiring sketch (how `useChat`/screens call the repo)
- **App start:** `repo.init()` → `repo.ensureDeviceId()` → use that id as the relay
  `userId` everywhere (replaces the per-session `u-xxxxxxx`).
- **ConversationsScreen:** `repo.getConversations()` for the list; refresh on focus.
- **New chat submit:** `repo.getOrCreateConversation(form)` → navigate into it.
- **Open chat (ChatScreen mount):** `repo.getMessages(id, {limit})` to render history
  *before* any relay round-trip → `repo.markConversationRead(id)` → emit `seen` for
  the returned ids → `relay.join(roomCode,{userId,displayName})`.
- **send():** `repo.addOutgoingMessage(id, payload)` **then** `relay.sendMessage`.
- **onMessage(payload):** `isOpen = (payload.roomId === activeRoomId)` (the boolean the
  mounted `ChatScreen` already owns; each conversation has a unique `room_code`) →
  `repo.addIncomingMessage(id, payload, {isOpen})` → if `inserted`: render, then
  `relay.delivered(payload.id)` when `!isOpen`, or `relay.seen(payload.id)` when
  `isOpen` (active-chat suppression already marked it `seen`). Duplicate → no acks.
- **onPeer 'delivered':** `repo.markDelivered(id)`.
- **onPeer 'played':** `repo.markPlayed(id)` (listened hint; no status change).
- **onPeer 'seen':** `repo.markSeen(id)` (dedicated event, §9/D6).
- **onPeer 'joined'/'peer_joined':** `repo.updatePeerIdentity(...)`.

---

## 12. Consequences

**Positive**
- One local, single-file, transactional store for history + unread + identity +
  settings; nothing on the server (privacy invariant intact, end-to-end).
- Reconnect-safe and order-independent by construction (idempotent insert + monotonic
  receipts + counters mutated only in SQL inside transactions). The "no race
  conditions" requirement is met without locks, an outbox, or a sequencer.
- Stored rows are a payload **superset**, so any message replays identically offline.
- Indexes match the exact Tier-1 query paths and pre-pay for Tier-2 pagination/search.
- The repo is the single choke-point for every invariant — UI cannot drift counters.

**Negative / trade-offs**
- The §7.4 transient (an ack landing a beat before its row shows `sent` slightly
  longer) is accepted rather than engineered away — fine for a 1:1 PoC, would want an
  outbox/sequencer at scale.
- The `seen` receipt requires a **small additive relay change** (a new id-only
  `seen` event in `server.js` + client emit/listener), now **finalised** (§9/D6,
  owned by `security`+`features`). It is the one cross-role contract this data layer
  depends on; the schema was already `seen`-ready, so no DB change followed from the
  decision.
- Single-device by design: history doesn't sync across a user's devices (explicit
  non-goal).

**Verification hooks for `qa` (zero-credit, `tests/**`)**
- Dedup: inserting the same `id` twice → one row; `unread_count` bumped once.
- Unread arithmetic: N incoming to a closed chat → badge N; `markConversationRead`
  → 0 and incoming rows `delivered→seen`; incoming to open chat → no bump, `seen`.
- Status monotonicity: `markDelivered` after `markSeen` does not regress.
- Create-or-resume: same `room_code` twice → one conversation row.
- FK/cascade: deleting a conversation removes its messages (latent path).

---

## 13. Self-verification against acceptance criteria

- [x] `docs/adr/sqlite-schema.md` written.
- [x] **Table structure** covered (refs the spec's authoritative columns; adds the
      `profile` table; rationale for surrogate vs. natural keys) — §3, §6, §8.
- [x] **Indexes for fast queries** — `(conversation_id, ts)` for thread reads,
      `UNIQUE(room_code)` as the roomId fast-path, `last_message_at DESC` for the
      list; deliberate note on why a separate `userId` index is unneeded in Tier 1
      (peer id is informational) — §6.
- [x] **Unread semantics** — mark on receive (txn-bound increment, dedup-safe),
      clear on open, active-chat suppression, never-negative, restart-persistent — §5.
- [x] **Transaction boundaries** — explicit rule + which mutations are transactional
      and why; counters only mutated inside transactions — §7.2.
- [x] **Relay events map cleanly to DB writes / no race conditions** — full event→
      mutation table, two-source `delivered`, concurrency model, the one real
      ordering race and its idempotent persist-before-emit resolution — §7.
- [x] **Repository interface spec'd** — `getConversations`, `getMessages`,
      `addMessage` (as `addOutgoing/addIncomingMessage`), `markDelivered`,
      `markConversationRead`, plus `getOrCreateConversation`, `markPlayed`,
      `markSeen`, `updatePeerIdentity`, profile ops — §11.
- [x] Conversation identity (id vs uuid/code), dedup strategy, FK constraints all
      decided — §3, §4, §6.
- [x] Cross-role open items resolved: `seen` receipt wire shape **decided**
      (dedicated id-only event, §9/D6, `security` sign-off) and profile store
      **decided** (1-row SQLite table, §8, `features` confirmation); repo interface
      confirmed integrable with `ChatScreen`/`useChat`/`ConversationsScreen` (§11),
      including the `isOpen = payload.roomId === activeRoomId` contract `features`
      verified the mounted screen can supply (§5, §11.8).
