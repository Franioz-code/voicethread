// VoiceThread — on-device SQLite schema + auto-migration (Tier-1 data layer).
// ============================================================================
// Source of truth for the DDL behind the 1:1 voice-first messenger's local
// store. Implements docs/MESSENGER-TIER1.md §1 (authoritative column/constraint
// contract) and docs/adr/sqlite-schema.md (rationale, identity, FK, unread,
// migration). Two tables — `conversations` + `messages` — plus a 1-row
// `profile` store (ADR §8). The relay (server.js) stores NOTHING; ALL durable
// state lives here, on the device.
//
// PRIVACY-BY-DESIGN: nothing in this file talks to a server. A persisted message
// row is a SUPERSET of the relay payload so it replays identically offline with
// no server round-trip for content.
//
// IMPORT-SAFE / ZERO-CREDIT: this module is pure data + pure functions. It does
// NOT import `expo-sqlite` or React Native, so the QA suite can `import` it under
// plain `node --test` to parse + validate the schema structure without a device,
// without a native module, and without spending a single ElevenLabs credit. The
// migration runner takes an INJECTED executor (the db is passed in by repo.js),
// so the same logic is testable against a fake executor.

// --- Versioning -------------------------------------------------------------
// Bumped via SQLite PRAGMA user_version (ADR §10). Tier-1 ships at 1. Forward-
// only: a future Tier-2 migration adds a step here; it must never drop/rename a
// Tier-1 column or weaken a constraint without a spec change.
export const SCHEMA_VERSION = 1;

// Stable identifiers reused by repo.js + tests (avoid stringly-typed drift).
export const DB_NAME = 'voicethread.db';
export const TABLES = { conversations: 'conversations', messages: 'messages', profile: 'profile' };
export const PROFILE_ID = 'me'; // single-row sentinel (ADR §8)

// Allowed message status values (status lifecycle, spec §1.2). Monotonic rank
// is used by repo.updateMessageStatus to never regress a receipt.
export const MESSAGE_STATUS = ['sent', 'delivered', 'seen'];
export const STATUS_RANK = { sent: 0, delivered: 1, seen: 2 };

// ============================================================================
//  Column specifications (the contract — also what tests assert against)
// ----------------------------------------------------------------------------
//  Mirrors MESSENGER-TIER1.md §1 exactly. Kept as DATA (not just baked into the
//  CREATE strings) so validateSchema() and the QA suite can assert the shape
//  structurally instead of regex-scraping SQL. `pk`/`fk`/`unique` flags here are
//  the source the DDL builder below consumes, so spec ↔ DDL cannot drift.
// ============================================================================

// conversations — one row per chat (one paired peer). ADR §3/§6, spec §1.1.
export const CONVERSATION_COLUMNS = [
  { name: 'id', type: 'TEXT', notNull: true, pk: true },                    // opaque local surrogate `c-xxxx` (NOT the room code)
  { name: 'room_code', type: 'TEXT', notNull: true, unique: true },          // = relay roomId; ^[A-Za-z0-9._:-]{1,64}$
  { name: 'owner_user_id', type: 'TEXT', notNull: false, default: 'NULL' },  // local device userId that owns this chat (multi-account-safe scoping)
  { name: 'peer_user_id', type: 'TEXT', notNull: false, default: 'NULL' },   // learned from joined/peer_joined; informational, never a key
  { name: 'peer_display_name', type: 'TEXT', notNull: false, default: 'NULL' },
  { name: 'contact_name', type: 'TEXT', notNull: true },                     // local label shown in list/header
  { name: 'contact_voice_id', type: 'TEXT', notNull: true },                 // voice to synthesize the PEER's messages
  { name: 'my_voice_id', type: 'TEXT', notNull: true },                      // voice stamped on OUR outgoing messages
  { name: 'created_at', type: 'INTEGER', notNull: true },                    // epoch ms
  { name: 'last_message_at', type: 'INTEGER', notNull: false, default: 'NULL' }, // drives list sort; NULL = no messages
  { name: 'last_message_preview', type: 'TEXT', notNull: false, default: 'NULL' },
  { name: 'unread_count', type: 'INTEGER', notNull: true, default: '0', check: 'unread_count >= 0' }, // never negative (spec §2)
  { name: 'archived', type: 'INTEGER', notNull: true, default: '0' },        // 0/1; Tier-1 always 0
];

// messages — one row per message, superset of the relay payload. ADR §4/§6, spec §1.2.
export const MESSAGE_COLUMNS = [
  { name: 'id', type: 'TEXT', notNull: true, pk: true },                     // payload id (useChat uid); dedup + receipt key
  { name: 'conversation_id', type: 'TEXT', notNull: true,                    // FK → conversations.id, indexed, cascade
    fk: { table: 'conversations', column: 'id', onDelete: 'CASCADE' } },
  { name: 'mine', type: 'INTEGER', notNull: true },                          // 1 = sent locally, 0 = received
  { name: 'sender', type: 'TEXT', notNull: false, default: 'NULL' },
  { name: 'text', type: 'TEXT', notNull: true, default: "''" },              // plain bubble text
  { name: 'tts_text', type: 'TEXT', notNull: false, default: 'NULL' },       // emotion-tagged text for replay (eleven_v3)
  { name: 'voice_id', type: 'TEXT', notNull: false, default: 'NULL' },       // sender's own voice (replay fallback)
  { name: 'model_id', type: 'TEXT', notNull: false, default: 'NULL' },
  { name: 'voice_settings', type: 'TEXT', notNull: false, default: 'NULL' }, // JSON string; parsed on read
  { name: 'emotion', type: 'TEXT', notNull: false, default: 'NULL' },
  { name: 'intensity', type: 'REAL', notNull: false, default: 'NULL' },
  { name: 'ts', type: 'INTEGER', notNull: true },                           // epoch ms; drives thread order + separators
  { name: 'status', type: 'TEXT', notNull: true, default: "'sent'",          // sent|delivered|seen
    check: "status IN ('sent','delivered','seen')" },
  { name: 'played', type: 'INTEGER', notNull: true, default: '0' },          // 0/1; ▶-played receipt
];

// profile — single durable row for device identity + Tier-1 settings. ADR §8.
export const PROFILE_COLUMNS = [
  { name: 'id', type: 'TEXT', notNull: true, pk: true },                     // always 'me' sentinel
  { name: 'device_user_id', type: 'TEXT', notNull: true },                   // persisted, stable relay userId
  { name: 'display_name', type: 'TEXT', notNull: false, default: 'NULL' },
  { name: 'default_voice_id', type: 'TEXT', notNull: false, default: 'NULL' },
  { name: 'theme', type: 'TEXT', notNull: true, default: "'light'" },        // 'light'|'dark'; light default
  { name: 'driving_mode', type: 'INTEGER', notNull: true, default: '0' },    // 0/1 eyes-free auto-read default
];

// Indexes (spec §1 / ADR §6). The composite (conversation_id, ts) is the thread
// workhorse + Tier-2 pagination index; UNIQUE(room_code) doubles as the roomId
// fast-path; last_message_at DESC drives list ordering.
export const INDEXES = [
  { name: 'idx_messages_convo_ts', table: 'messages', columns: ['conversation_id', 'ts'] },
  { name: 'idx_messages_convo_unread', table: 'messages', columns: ['conversation_id', 'mine', 'status'] },
  { name: 'idx_conversations_last_msg', table: 'conversations', columns: ['last_message_at DESC'] },
];

// ============================================================================
//  DDL builder (column specs -> CREATE TABLE strings)
// ----------------------------------------------------------------------------
//  Building the SQL FROM the specs above guarantees the DDL and the validated
//  contract are the same thing. No hand-maintained SQL string to drift.
// ============================================================================

function columnDDL(col) {
  let sql = `${col.name} ${col.type}`;
  if (col.pk) sql += ' PRIMARY KEY';
  if (col.notNull) sql += ' NOT NULL';
  if (col.unique && !col.pk) sql += ' UNIQUE';
  if (col.default !== undefined) sql += ` DEFAULT ${col.default}`;
  if (col.check) sql += ` CHECK (${col.check})`;
  return sql;
}

function tableDDL(tableName, columns) {
  const lines = columns.map(columnDDL);
  // Append FK clauses (table-level) for any column that declares one.
  for (const col of columns) {
    if (col.fk) {
      lines.push(
        `FOREIGN KEY (${col.name}) REFERENCES ${col.fk.table}(${col.fk.column})` +
          (col.fk.onDelete ? ` ON DELETE ${col.fk.onDelete}` : '')
      );
    }
  }
  return `CREATE TABLE IF NOT EXISTS ${tableName} (\n  ${lines.join(',\n  ')}\n);`;
}

function indexDDL(idx) {
  return `CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} (${idx.columns.join(', ')});`;
}

// The full, ordered DDL. Order matters: conversations BEFORE messages so the FK
// target exists; indexes last. Every statement is IF NOT EXISTS → idempotent
// (ADR §10): re-running the bootstrap on an existing DB is a no-op.
export const DDL = {
  conversations: tableDDL(TABLES.conversations, CONVERSATION_COLUMNS),
  messages: tableDDL(TABLES.messages, MESSAGE_COLUMNS),
  profile: tableDDL(TABLES.profile, PROFILE_COLUMNS),
  indexes: INDEXES.map(indexDDL),
};

/** Every DDL statement in apply-order (tables first, then indexes). */
export function allStatements() {
  return [DDL.conversations, DDL.messages, DDL.profile, ...DDL.indexes];
}

// ============================================================================
//  Auto-migration (check_schema_version) — runs on first app load
// ----------------------------------------------------------------------------
//  Versioned via PRAGMA user_version. The executor is INJECTED so this is unit-
//  testable without expo-sqlite. Contract for `exec` (satisfied by repo.js
//  wrapping expo-sqlite's async API):
//     exec.getVersion(): Promise<number>          -> PRAGMA user_version
//     exec.setVersion(n): Promise<void>           -> PRAGMA user_version = n
//     exec.run(sql): Promise<void>                -> execute one/many statements
//     exec.withTransaction(fn): Promise<void>     -> wrap fn() in BEGIN/COMMIT
//  The whole bootstrap runs inside ONE transaction (ADR §7.2/§10) so a crash
//  mid-migration leaves the DB untouched, never half-migrated.
// ============================================================================

/**
 * Check the on-disk schema version and migrate forward if it is behind.
 * Idempotent: a DB already at SCHEMA_VERSION is left untouched (no-op).
 *
 * @param {object} exec injected executor (see contract above)
 * @returns {Promise<{from:number,to:number,migrated:boolean}>}
 */
export async function checkSchemaVersion(exec) {
  const from = (await exec.getVersion()) || 0;
  if (from >= SCHEMA_VERSION) {
    return { from, to: from, migrated: false };
  }
  await exec.withTransaction(async () => {
    // Forward-only migration steps. Each step migrates from version (idx) -> idx+1.
    // v0 -> v1 : create the Tier-1 tables + indexes.
    if (from < 1) {
      for (const stmt of allStatements()) {
        await exec.run(stmt);
      }
    }
    // (future) if (from < 2) { ...Tier-2 additive steps... }
    await exec.setVersion(SCHEMA_VERSION);
  });
  return { from, to: SCHEMA_VERSION, migrated: true };
}

// Snake_case alias for the migration entry point (the name used in the backlog/
// task: "check_schema_version"). Same function, idiomatic + literal both work.
export const check_schema_version = checkSchemaVersion;

// ============================================================================
//  Structure validation (zero-credit; used by the QA suite + repo self-check)
// ----------------------------------------------------------------------------
//  Parses/validates the schema STRUCTURE without a database. Returns a plain
//  report so a test can assert each acceptance criterion explicitly.
// ============================================================================

/** Find a column spec by name in a column list. */
function findCol(columns, name) {
  return columns.find((c) => c.name === name) || null;
}

/**
 * Validate the declared schema against the Tier-1 acceptance criteria.
 * Pure + synchronous — safe to call from `node --test`. Throws on a structural
 * violation (so a failing schema fails loudly); returns a summary on success.
 */
export function validateSchema() {
  const problems = [];

  // -- conversations PK + UNIQUE(room_code) + unread_count + archived ---------
  const convPk = CONVERSATION_COLUMNS.filter((c) => c.pk).map((c) => c.name);
  if (convPk.length !== 1 || convPk[0] !== 'id') problems.push('conversations must have single PK `id`');
  const roomCode = findCol(CONVERSATION_COLUMNS, 'room_code');
  if (!roomCode || !roomCode.unique) problems.push('conversations.room_code must be UNIQUE (roomId fast-path)');
  const unread = findCol(CONVERSATION_COLUMNS, 'unread_count');
  if (!unread) problems.push('conversations.unread_count field must exist');
  else if (!unread.notNull) problems.push('conversations.unread_count must be NOT NULL');
  else if (unread.default !== '0') problems.push('conversations.unread_count must default to 0');

  // -- messages PK, FK, indexed roomId path, ts NOT NULL ---------------------
  const msgPk = MESSAGE_COLUMNS.filter((c) => c.pk).map((c) => c.name);
  if (msgPk.length !== 1 || msgPk[0] !== 'id') problems.push('messages must have single PK `id`');
  const convFk = findCol(MESSAGE_COLUMNS, 'conversation_id');
  if (!convFk || !convFk.fk || convFk.fk.table !== 'conversations' || convFk.fk.column !== 'id') {
    problems.push('messages.conversation_id must FOREIGN KEY -> conversations(id)');
  }
  if (!convFk || !convFk.notNull) problems.push('messages.conversation_id must be NOT NULL');
  const ts = findCol(MESSAGE_COLUMNS, 'ts');
  if (!ts || !ts.notNull) problems.push('messages.ts must be NOT NULL');
  const status = findCol(MESSAGE_COLUMNS, 'status');
  if (!status || !status.check || !/seen/.test(status.check)) {
    problems.push('messages.status must constrain to sent|delivered|seen');
  }

  // -- indexes: roomId (room_code UNIQUE) + per-conversation thread read ------
  const hasConvoTs = INDEXES.some(
    (i) => i.table === 'messages' && i.columns[0] === 'conversation_id' && i.columns.includes('ts')
  );
  if (!hasConvoTs) problems.push('missing composite index (conversation_id, ts) for thread reads');
  // roomId is "indexed" via the UNIQUE(room_code) constraint (an implicit index).
  if (!roomCode || !roomCode.unique) problems.push('roomId (room_code) must be indexed (UNIQUE)');

  if (problems.length) {
    throw new Error('Schema validation failed:\n  - ' + problems.join('\n  - '));
  }

  return {
    ok: true,
    version: SCHEMA_VERSION,
    tables: {
      conversations: CONVERSATION_COLUMNS.map((c) => c.name),
      messages: MESSAGE_COLUMNS.map((c) => c.name),
      profile: PROFILE_COLUMNS.map((c) => c.name),
    },
    indexes: INDEXES.map((i) => i.name),
  };
}

export default {
  SCHEMA_VERSION,
  DB_NAME,
  TABLES,
  PROFILE_ID,
  MESSAGE_STATUS,
  STATUS_RANK,
  CONVERSATION_COLUMNS,
  MESSAGE_COLUMNS,
  PROFILE_COLUMNS,
  INDEXES,
  DDL,
  allStatements,
  checkSchemaVersion,
  check_schema_version,
  validateSchema,
};
