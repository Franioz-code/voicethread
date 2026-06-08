// VoiceThread — SQLite repository (Tier-1 data layer).
// ============================================================================
// The single choke-point for all on-device persistence. Opens the DB, runs the
// schema/migration (src/db/schema.js → checkSchemaVersion), and exposes async
// CRUD. NO SQL leaks past this module — screens / useChat call these methods,
// never raw queries — which is what lets the repo own every invariant
// (idempotent insert, monotonic receipts, unread counters mutated only inside
// transactions). Interface follows docs/adr/sqlite-schema.md §11 and the Tier-1
// task contract.
//
// PRIVACY-BY-DESIGN: this module talks ONLY to the local SQLite file. Nothing
// here reaches a server. A persisted message row is a SUPERSET of the relay
// payload so it replays identically offline (no server round-trip for content).
//
// EXPO GO: backed by `expo-sqlite` (Expo-Go-safe). The native module is imported
// LAZILY inside open() so this file stays import-safe for the zero-credit QA
// suite — tests can `import` the schema + drive the repo against an injected
// fake db without bundling React Native / expo-sqlite.
//
// CONVENTIONS (ADR §11): all times are integer epoch ms (UTC) to match
// Date.now()/payload `ts`. Booleans are 0/1. `voice_settings` is stored as a
// JSON string and parsed on read. Status advances only sent → delivered → seen.

import {
  DB_NAME,
  TABLES,
  PROFILE_ID,
  STATUS_RANK,
  checkSchemaVersion,
  validateSchema,
} from './schema.js';

// --- id minting -------------------------------------------------------------
// Conversation ids are opaque local surrogates (ADR §3): `c-<base36 rand>`.
// Mirrors the style of useChat's uid() without coupling to it.
function newConversationId() {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function newDeviceId() {
  return `u-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// --- JSON helpers (voice_settings round-trip) -------------------------------
function serializeSettings(vs) {
  if (vs == null) return null;
  try { return JSON.stringify(vs); } catch { return null; }
}
function parseSettings(raw) {
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// --- row → app-shape mappers (snake_case DB → camelCase domain) -------------
function rowToConversation(r) {
  if (!r) return null;
  return {
    id: r.id,
    roomCode: r.room_code,
    ownerUserId: r.owner_user_id ?? null,
    peerUserId: r.peer_user_id ?? null,
    peerDisplayName: r.peer_display_name ?? null,
    contactName: r.contact_name,
    contactVoiceId: r.contact_voice_id,
    myVoiceId: r.my_voice_id,
    createdAt: r.created_at,
    lastMessageAt: r.last_message_at ?? null,
    lastMessagePreview: r.last_message_preview ?? null,
    unreadCount: r.unread_count,
    archived: r.archived,
  };
}
function rowToMessage(r) {
  if (!r) return null;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    mine: !!r.mine,
    sender: r.sender ?? null,
    text: r.text ?? '',
    ttsText: r.tts_text ?? null,
    voiceId: r.voice_id ?? null,
    modelId: r.model_id ?? null,
    voiceSettings: parseSettings(r.voice_settings),
    emotion: r.emotion ?? null,
    intensity: r.intensity ?? null,
    ts: r.ts,
    status: r.status,
    played: !!r.played,
  };
}

// ============================================================================
//  Connection + executor
// ----------------------------------------------------------------------------
//  One DB handle per app process. `_exec` adapts the raw expo-sqlite handle to
//  the small executor contract checkSchemaVersion() expects, and is reused
//  internally for all queries. Tests may inject a fake handle via __setDb().
// ============================================================================

let _db = null;          // raw expo-sqlite database handle (or injected fake)
let _ready = false;      // has open() finished setup (PRAGMA + migration + profile)?
let _initPromise = null; // de-dupes concurrent init() calls

// Build the executor contract used by schema.checkSchemaVersion + this module.
function makeExec(db) {
  return {
    async getVersion() {
      const row = await db.getFirstAsync('PRAGMA user_version;');
      // expo-sqlite returns { user_version: N }
      return row ? (row.user_version ?? Object.values(row)[0] ?? 0) : 0;
    },
    async setVersion(n) {
      // PRAGMA can't be parameterized; n is an internal integer constant.
      await db.execAsync(`PRAGMA user_version = ${Number(n) | 0};`);
    },
    async run(sql) { await db.execAsync(sql); },
    async withTransaction(fn) {
      if (typeof db.withTransactionAsync === 'function') {
        await db.withTransactionAsync(fn);
      } else {
        await db.execAsync('BEGIN;');
        try { await fn(); await db.execAsync('COMMIT;'); }
        catch (e) { try { await db.execAsync('ROLLBACK;'); } catch { /* ignore */ } throw e; }
      }
    },
  };
}

/**
 * Open the database, enable foreign keys, run schema/migrations, ensure the
 * profile row + device id. Safe to call repeatedly — idempotent and de-duped.
 * @returns {Promise<object>} the raw db handle
 */
export async function open() {
  if (_ready && _db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    if (!_db) {
      // Lazy import keeps this module loadable under plain Node for tests.
      const SQLite = await import('expo-sqlite');
      const openAsync = SQLite.openDatabaseAsync || SQLite.default?.openDatabaseAsync;
      _db = await openAsync(DB_NAME);
    }
    // FKs default OFF in SQLite/expo-sqlite — enable per connection (ADR §6).
    await _db.execAsync('PRAGMA foreign_keys = ON;');
    // Validate the declared schema structure before we create it (cheap guard).
    validateSchema();
    // Create tables/indexes + bump user_version inside one transaction (ADR §10).
    await checkSchemaVersion(makeExec(_db));
    await ensureDeviceId();
    _ready = true;
    return _db;
  })();

  try {
    return await _initPromise;
  } finally {
    _initPromise = null;
  }
}

/** Alias for the lifecycle name used in the ADR (§11.1). */
export const init = open;

/**
 * Test seam: inject a fake db handle (must satisfy the expo-sqlite async API).
 * Leaves the repo UN-initialized so the next open()/query still runs the
 * PRAGMA + migration + profile bootstrap against the injected handle — this is
 * what lets the zero-credit QA suite drive the real repo logic against a fake.
 */
export function __setDb(fake) {
  _db = fake;
  _ready = false;
  _initPromise = null;
}

/** Test/teardown seam: close + drop the handle. */
export async function close() {
  if (_db && typeof _db.closeAsync === 'function') {
    try { await _db.closeAsync(); } catch { /* ignore */ }
  }
  _db = null;
  _ready = false;
  _initPromise = null;
}

// Internal: ensure the db is open + migrated before a query (callers may forget
// init()). Always routes through open() until setup has completed.
async function db() {
  if (_ready && _db) return _db;
  return open();
}

// ============================================================================
//  Profile (device identity + Tier-1 settings) — ADR §8
// ============================================================================

/** Return the persisted device userId, generating + storing it once on first run. */
export async function ensureDeviceId() {
  const conn = _db || (await open());
  const existing = await conn.getFirstAsync(
    `SELECT device_user_id FROM ${TABLES.profile} WHERE id = ?;`,
    [PROFILE_ID]
  );
  if (existing && existing.device_user_id) return existing.device_user_id;
  const deviceUserId = newDeviceId();
  await conn.runAsync(
    `INSERT OR IGNORE INTO ${TABLES.profile}
       (id, device_user_id, theme, driving_mode) VALUES (?, ?, 'light', 0);`,
    [PROFILE_ID, deviceUserId]
  );
  // Re-read in case a concurrent caller won the INSERT race.
  const row = await conn.getFirstAsync(
    `SELECT device_user_id FROM ${TABLES.profile} WHERE id = ?;`,
    [PROFILE_ID]
  );
  return row?.device_user_id || deviceUserId;
}

/** Read the profile (device id + settings). */
export async function getProfile() {
  const conn = await db();
  const r = await conn.getFirstAsync(`SELECT * FROM ${TABLES.profile} WHERE id = ?;`, [PROFILE_ID]);
  if (!r) return null;
  return {
    deviceUserId: r.device_user_id,
    displayName: r.display_name ?? null,
    defaultVoiceId: r.default_voice_id ?? null,
    theme: r.theme,
    drivingMode: !!r.driving_mode,
  };
}

/** Partial update of display_name / default_voice_id / theme / driving_mode. */
export async function updateProfile(patch = {}) {
  const conn = await db();
  const map = {
    displayName: 'display_name',
    defaultVoiceId: 'default_voice_id',
    theme: 'theme',
    drivingMode: 'driving_mode',
  };
  const sets = [];
  const args = [];
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) {
      sets.push(`${col} = ?`);
      args.push(k === 'drivingMode' ? (patch[k] ? 1 : 0) : patch[k]);
    }
  }
  if (sets.length) {
    args.push(PROFILE_ID);
    await conn.runAsync(`UPDATE ${TABLES.profile} SET ${sets.join(', ')} WHERE id = ?;`, args);
  }
  return getProfile();
}

// ============================================================================
//  Conversations
// ============================================================================

/**
 * List conversations owned by a user, newest-active first.
 * @param {string} [userId] owner device id; if omitted, returns all (single-account PoC).
 */
export async function getConversations(userId) {
  const conn = await db();
  // Order: messaged chats by last_message_at DESC, never-messaged after, by
  // created_at DESC (spec §4 / ADR §11.3). archived=0 only.
  const order =
    'ORDER BY (last_message_at IS NULL) ASC, last_message_at DESC, created_at DESC';
  let rows;
  if (userId == null) {
    rows = await conn.getAllAsync(
      `SELECT * FROM ${TABLES.conversations} WHERE archived = 0 ${order};`
    );
  } else {
    rows = await conn.getAllAsync(
      `SELECT * FROM ${TABLES.conversations}
         WHERE archived = 0 AND (owner_user_id = ? OR owner_user_id IS NULL) ${order};`,
      [userId]
    );
  }
  return (rows || []).map(rowToConversation);
}

/** Look up a conversation by its opaque id. */
export async function getConversation(id) {
  const conn = await db();
  const r = await conn.getFirstAsync(`SELECT * FROM ${TABLES.conversations} WHERE id = ?;`, [id]);
  return rowToConversation(r);
}

/** Look up a conversation by its room_code (= relay roomId). */
export async function getConversationByRoomCode(roomCode) {
  const conn = await db();
  const r = await conn.getFirstAsync(
    `SELECT * FROM ${TABLES.conversations} WHERE room_code = ?;`,
    [roomCode]
  );
  return rowToConversation(r);
}

/**
 * Create-or-resume a conversation (idempotent on UNIQUE(room_code), ADR §3.2).
 * Existing row → returned (and contact_name/voice ids refreshed if changed);
 * else inserted with a fresh id. NEVER creates a duplicate for a room_code.
 *
 * Faithful to the Tier-1 task signature `(userId, contactName, contactVoiceId)`,
 * with the remaining REQUIRED schema fields (room_code, my_voice_id) supplied via
 * `opts` — both are NOT NULL in the schema, so they must be provided.
 *
 * @param {string} userId        owner device id (stamped as owner_user_id)
 * @param {string} contactName   local label for the chat (contact_name)
 * @param {string} contactVoiceId voice to synthesize the PEER (contact_voice_id)
 * @param {object} opts          { roomCode, myVoiceId, peerDisplayName?, peerUserId? }
 */
export async function findOrCreateConversation(userId, contactName, contactVoiceId, opts = {}) {
  const conn = await db();
  const roomCode = opts.roomCode != null ? opts.roomCode : contactName; // fallback: code == label
  const myVoiceId = opts.myVoiceId != null ? opts.myVoiceId : contactVoiceId; // last-resort fallback
  const label = contactName != null && contactName !== '' ? contactName : roomCode;

  let result = null;
  const exec = makeExec(conn);
  await exec.withTransaction(async () => {
    const existing = await conn.getFirstAsync(
      `SELECT * FROM ${TABLES.conversations} WHERE room_code = ?;`,
      [roomCode]
    );
    if (existing) {
      // Resume: refresh mutable label/voice fields if the caller changed them.
      await conn.runAsync(
        `UPDATE ${TABLES.conversations}
            SET contact_name = ?, contact_voice_id = ?, my_voice_id = ?,
                owner_user_id = COALESCE(?, owner_user_id)
          WHERE room_code = ?;`,
        [label, contactVoiceId, myVoiceId, userId ?? null, roomCode]
      );
      result = await conn.getFirstAsync(
        `SELECT * FROM ${TABLES.conversations} WHERE room_code = ?;`,
        [roomCode]
      );
      return;
    }
    // Create: fresh opaque id; INSERT OR IGNORE absorbs a double-submit race.
    const id = newConversationId();
    await conn.runAsync(
      `INSERT OR IGNORE INTO ${TABLES.conversations}
         (id, room_code, owner_user_id, peer_user_id, peer_display_name,
          contact_name, contact_voice_id, my_voice_id,
          created_at, last_message_at, last_message_preview, unread_count, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0);`,
      [
        id, roomCode, userId ?? null, opts.peerUserId ?? null, opts.peerDisplayName ?? null,
        label, contactVoiceId, myVoiceId, Date.now(),
      ]
    );
    // Re-read by room_code so a racing INSERT's winner is what we return.
    result = await conn.getFirstAsync(
      `SELECT * FROM ${TABLES.conversations} WHERE room_code = ?;`,
      [roomCode]
    );
  });
  return rowToConversation(result);
}

/** Update peer identity learned from joined/peer_joined (informational; ADR §11.4). */
export async function updatePeerIdentity(conversationId, { peerUserId, peerDisplayName } = {}) {
  const conn = await db();
  await conn.runAsync(
    `UPDATE ${TABLES.conversations}
        SET peer_user_id = COALESCE(?, peer_user_id),
            peer_display_name = COALESCE(?, peer_display_name)
      WHERE id = ?;`,
    [peerUserId ?? null, peerDisplayName ?? null, conversationId]
  );
}

/**
 * Clear unread on open (spec §2.3 / ADR §5), keyed by roomId per the task
 * signature. One transaction: zero the counter AND flip this chat's incoming
 * delivered→seen rows. Returns the message ids it flipped so the caller can emit
 * `seen` receipts for exactly those.
 * @param {string} roomId the conversation's room_code
 * @returns {Promise<string[]>} ids flipped delivered→seen
 */
export async function markConversationRead(roomId) {
  const conn = await db();
  const convo = await conn.getFirstAsync(
    `SELECT id FROM ${TABLES.conversations} WHERE room_code = ?;`,
    [roomId]
  );
  if (!convo) return [];
  const convoId = convo.id;

  let flipped = [];
  const exec = makeExec(conn);
  await exec.withTransaction(async () => {
    // Capture the ids about to flip (for seen receipts) BEFORE updating.
    const rows = await conn.getAllAsync(
      `SELECT id FROM ${TABLES.messages}
         WHERE conversation_id = ? AND mine = 0 AND status = 'delivered';`,
      [convoId]
    );
    flipped = (rows || []).map((r) => r.id);
    await conn.runAsync(
      `UPDATE ${TABLES.conversations} SET unread_count = 0 WHERE id = ?;`,
      [convoId]
    );
    await conn.runAsync(
      `UPDATE ${TABLES.messages}
          SET status = 'seen'
        WHERE conversation_id = ? AND mine = 0 AND status = 'delivered';`,
      [convoId]
    );
  });
  return flipped;
}

/** Delete a conversation and (via FK CASCADE) all its messages. ADR §6. */
export async function deleteConversation(id) {
  const conn = await db();
  // Defence-in-depth: delete messages explicitly too, in case a connection
  // somehow has foreign_keys OFF (open() always turns them ON).
  const exec = makeExec(conn);
  await exec.withTransaction(async () => {
    await conn.runAsync(`DELETE FROM ${TABLES.messages} WHERE conversation_id = ?;`, [id]);
    await conn.runAsync(`DELETE FROM ${TABLES.conversations} WHERE id = ?;`, [id]);
  });
}

// ============================================================================
//  Messages
// ============================================================================

/**
 * Load a conversation's messages oldest→newest, keyed by roomId (task
 * signature). Uses the (conversation_id, ts) index. Parses voice_settings.
 * @param {string} roomId the conversation's room_code
 * @param {object} [opts] { limit?, beforeTs? } — beforeTs enables Tier-2 "load older"
 */
export async function getMessages(roomId, opts = {}) {
  const conn = await db();
  const convo = await conn.getFirstAsync(
    `SELECT id FROM ${TABLES.conversations} WHERE room_code = ?;`,
    [roomId]
  );
  if (!convo) return [];
  const convoId = convo.id;

  const where = ['conversation_id = ?'];
  const args = [convoId];
  if (opts.beforeTs != null) { where.push('ts < ?'); args.push(opts.beforeTs); }

  let sql = `SELECT * FROM ${TABLES.messages} WHERE ${where.join(' AND ')} ORDER BY ts ASC, id ASC`;
  if (opts.limit != null) { sql += ' LIMIT ?'; args.push(opts.limit | 0); }

  const rows = await conn.getAllAsync(sql + ';', args);
  return (rows || []).map(rowToMessage);
}

/** Fetch a single message by id (dedup/receipt helper). */
export async function getMessageById(id) {
  const conn = await db();
  const r = await conn.getFirstAsync(`SELECT * FROM ${TABLES.messages} WHERE id = ?;`, [id]);
  return rowToMessage(r);
}

/**
 * Persist a message (sent or received). Idempotent by id (INSERT OR IGNORE,
 * dedup per ADR §4). Resolves the conversation from `conversationId` or
 * `roomId`. When the row is NEWLY inserted, updates the conversation summary in
 * the SAME transaction (last_message_at/preview), and for an incoming message
 * that is NOT in the open chat, increments unread_count — counters move only
 * inside SQL inside a transaction (ADR §7), so re-deliveries cannot inflate them.
 *
 * @param {object} message {
 *   id, conversationId|roomId, mine, sender?, text, ttsText?, voiceId?, modelId?,
 *   voiceSettings?, emotion?, intensity?, ts?, status?, played? }
 * @param {object} [opts] { isOpen? } active-chat suppression flag (caller-owned)
 * @returns {Promise<{inserted:boolean, message:object|null}>}
 */
export async function addMessage(message = {}, opts = {}) {
  const conn = await db();

  // Resolve the conversation id (accept either an explicit id or a room_code).
  let conversationId = message.conversationId;
  if (!conversationId && message.roomId) {
    const c = await conn.getFirstAsync(
      `SELECT id FROM ${TABLES.conversations} WHERE room_code = ?;`,
      [message.roomId]
    );
    conversationId = c?.id;
  }
  if (!conversationId) {
    throw new Error('addMessage: conversationId (or a known roomId) is required');
  }

  const mine = message.mine ? 1 : 0;
  const ts = message.ts != null ? message.ts : Date.now();
  // Sensible initial status: outgoing -> 'sent'; incoming -> 'seen' if the chat
  // is open (active-chat suppression), else 'delivered'. Caller may override.
  const status =
    message.status ||
    (mine ? 'sent' : (opts.isOpen ? 'seen' : 'delivered'));
  const played = message.played ? 1 : 0;
  const text = message.text != null ? message.text : '';

  let inserted = false;
  const exec = makeExec(conn);
  await exec.withTransaction(async () => {
    const res = await conn.runAsync(
      `INSERT OR IGNORE INTO ${TABLES.messages}
         (id, conversation_id, mine, sender, text, tts_text, voice_id, model_id,
          voice_settings, emotion, intensity, ts, status, played)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        message.id, conversationId, mine, message.sender ?? null, text,
        message.ttsText ?? null, message.voiceId ?? null, message.modelId ?? null,
        serializeSettings(message.voiceSettings), message.emotion ?? null,
        message.intensity ?? null, ts, status, played,
      ]
    );
    // expo-sqlite runAsync returns { changes, lastInsertRowId }.
    inserted = (res?.changes ?? 0) > 0;
    if (!inserted) return; // duplicate → NO side effects (dedup-safe, ADR §4/§5)

    // New row → update the conversation summary (preview = plain text, not tags).
    const preview = text.length > 140 ? text.slice(0, 140) : text;
    await conn.runAsync(
      `UPDATE ${TABLES.conversations}
          SET last_message_at = ?, last_message_preview = ?
        WHERE id = ?;`,
      [ts, preview, conversationId]
    );
    // Incoming + not currently open → bump unread (in-txn, dedup-safe).
    if (!mine && !opts.isOpen) {
      await conn.runAsync(
        `UPDATE ${TABLES.conversations}
            SET unread_count = unread_count + 1
          WHERE id = ?;`,
        [conversationId]
      );
    }
  });

  const saved = await getMessageById(message.id);
  return { inserted, message: saved };
}

/**
 * Advance a message's status (monotonic; never regresses). Wired to relay
 * delivered/seen acks (ADR §11.6). Safe if the row doesn't exist yet (matches 0
 * rows — the §7.4 benign ordering). `status` ∈ {sent,delivered,seen}.
 * @returns {Promise<boolean>} whether a row was advanced
 */
export async function updateMessageStatus(id, status) {
  if (!(status in STATUS_RANK)) {
    throw new Error(`updateMessageStatus: invalid status "${status}"`);
  }
  const conn = await db();
  // Guard with a rank check so a late 'delivered' after 'seen' is ignored. The
  // CASE expression maps the stored status to its rank entirely in SQL.
  const targetRank = STATUS_RANK[status];
  const res = await conn.runAsync(
    `UPDATE ${TABLES.messages}
        SET status = ?
      WHERE id = ?
        AND (CASE status WHEN 'sent' THEN 0 WHEN 'delivered' THEN 1 WHEN 'seen' THEN 2 ELSE 0 END) < ?;`,
    [status, id, targetRank]
  );
  return (res?.changes ?? 0) > 0;
}

/** Mark a message as ▶-played (idempotent; voice-first "listened" hint, ADR §11.6). */
export async function markPlayed(id) {
  const conn = await db();
  await conn.runAsync(
    `UPDATE ${TABLES.messages} SET played = 1 WHERE id = ?;`,
    [id]
  );
}

/** Total unread across conversations (optional tab/title badge, ADR §11.3). */
export async function getTotalUnread() {
  const conn = await db();
  const r = await conn.getFirstAsync(
    `SELECT COALESCE(SUM(unread_count), 0) AS total
       FROM ${TABLES.conversations} WHERE archived = 0;`
  );
  return r?.total ?? 0;
}

export default {
  init,
  open,
  close,
  __setDb,
  ensureDeviceId,
  getProfile,
  updateProfile,
  getConversations,
  getConversation,
  getConversationByRoomCode,
  findOrCreateConversation,
  updatePeerIdentity,
  markConversationRead,
  deleteConversation,
  getMessages,
  getMessageById,
  addMessage,
  updateMessageStatus,
  markPlayed,
  getTotalUnread,
};
