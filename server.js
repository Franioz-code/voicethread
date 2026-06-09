// ============================================================================
//  VoiceThread — backend server (2.0)
// ----------------------------------------------------------------------------
//  Express + Socket.IO server that:
//    1. Proxies ALL ElevenLabs API calls (the API key NEVER reaches the client).
//    2. Relays chat messages between two paired devices (in memory, never stored).
//  The API key lives only here, in the ELEVENLABS_API_KEY env var (see README).
// ============================================================================

import 'dotenv/config'; // loads a .env file into process.env (if one exists)
import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
//  >>>>>>>>>>>>>>>>>>>>>>>>  CONFIG — EDIT ME  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
//  Voice IDs, models and behaviour all live here so they are easy to swap.
//  Find voice IDs at https://elevenlabs.io/app/voices, or — while running —
//  open http://localhost:3000/api/voices to list voices your account can use.
//  NOTE: on the FREE tier the API only allows "premade"/default voices; Voice
//  Library voices return HTTP 402. Voice CLONING needs a PAID plan.
// ============================================================================
const CONFIG = {
  // Demo participants for the bundled web page (public/index.html). The real
  // mobile app keeps contacts+voices on the device; these are just for the demo.
  participants: [
    { name: 'Ola',    self: false, voiceId: 'EXAVITQu4vr4xnSDxMaL' }, // Sarah — female (premade)
    { name: 'Franek', self: true,  voiceId: 'pNInz6obpgDQGcFmaJgB' }, // Adam  — male   (premade)
  ],

  // Text-to-Speech models, chosen per use-case:
  //   emotion  -> eleven_v3 understands inline audio tags like [happy]/[sad]
  //   latency  -> eleven_flash_v2_5 (~75ms, 0.5 credit/char) for driving-mode auto-read
  //   fallback -> eleven_multilingual_v2 (reliable, natural Polish) and the DEFAULT
  ttsModels: {
    emotion: 'eleven_v3',
    latency: 'eleven_flash_v2_5',
    fallback: 'eleven_multilingual_v2',
  },
  defaultVoiceSettings: { stability: 0.5, similarity_boost: 0.8, style: 0, use_speaker_boost: true },

  // Speech-to-Text (Scribe) — used for transcribing spoken replies.
  sttModelId: 'scribe_v1', // newer option: 'scribe_v2'
  sttLanguage: 'pl',       // ISO-639-1; '' = auto-detect (good for mixed languages)

  ttsOutputFormat: 'mp3_44100_128', // codec_samplerate_bitrate

  // mp3 cache mode. 'memory' = nothing written to disk (privacy default);
  // 'disk' = persists across restarts (saves quota); 'off' = no caching.
  cache: 'memory',
  cacheTtlMs: 30 * 60 * 1000, // entries older than this are re-synthesized

  // Message relay (Socket.IO) settings.
  relay: {
    maxRoomMembers: 2,                         // a conversation room holds 2 people
    msgRateLimit: { points: 30, perMs: 10000 }, // max messages per socket per window
    // Hard caps applied to EVERY inbound socket payload before it is relayed.
    // The relay is a dumb pipe — these stop an abusive client from flooding the
    // peer or pinning memory. Message CONTENT is never inspected beyond size.
    maxRoomIdLen: 64,        // pairing-code length cap
    maxUserIdLen: 64,        // identity field length caps
    maxDisplayNameLen: 64,
    maxMessageIdLen: 128,    // message id used only for delivery/played acks
    // Serialized-size cap for a relayed message payload. Generous enough for a
    // 5000-char (the TTS text cap) multibyte message plus emotion/voice metadata,
    // but small enough to stop a client flooding the peer with megabyte frames.
    maxMessageBytes: 48 * 1024,
    socketMaxHttpBufferSize: 64 * 1024, // engine.io frame cap (must be >= maxMessageBytes)
  },

  // Allowed character set for a room/pairing code AND for user ids. Anything
  // outside this set is rejected (prevents weird control chars / huge unicode).
  roomIdPattern: /^[A-Za-z0-9._:-]{1,64}$/,
  userIdPattern: /^[A-Za-z0-9._:-]{1,64}$/,

  // CORS posture (see SECURITY.md): a permissive '*' is acceptable for a LOCAL
  // prototype because the server holds NO cookies/sessions and NO user data —
  // the only secret (the ElevenLabs key) never leaves the server. Set
  // CORS_ORIGIN to a comma-separated allow-list for any real deployment.
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : '*',

  port: process.env.PORT || 3000,
};
// ============================================================================

const ELEVEN_API = 'https://api.elevenlabs.io/v1';
const API_KEY = process.env.ELEVENLABS_API_KEY || '';

// ---------------------------------------------------------------------------
//  TTS cache, keyed by (voiceId + model + format + voiceSettings + text) so a
//  v3 clip is never confused with a flash clip of the same text. Honors the
//  CONFIG.cache mode and a TTL. This is the "cache by text+voiceId" from the
//  spec — no database.
// ---------------------------------------------------------------------------
const CACHE_DIR = path.join(__dirname, '.cache');
const memCache = new Map(); // key -> { buf, ts }
if (CONFIG.cache === 'disk') fs.mkdirSync(CACHE_DIR, { recursive: true });

const cacheKey = (parts) => crypto.createHash('sha1').update(parts.join('::')).digest('hex');

function cacheGet(key) {
  if (CONFIG.cache === 'off') return null;
  const now = Date.now();
  const mem = memCache.get(key);
  if (mem) {
    if (CONFIG.cacheTtlMs && now - mem.ts > CONFIG.cacheTtlMs) memCache.delete(key);
    else return mem.buf;
  }
  if (CONFIG.cache === 'disk') {
    const file = path.join(CACHE_DIR, `${key}.mp3`);
    try {
      const stat = fs.statSync(file);
      if (CONFIG.cacheTtlMs && now - stat.mtimeMs > CONFIG.cacheTtlMs) { fs.unlinkSync(file); return null; }
      const buf = fs.readFileSync(file);
      memCache.set(key, { buf, ts: now });
      return buf;
    } catch { return null; }
  }
  return null;
}

function cacheSet(key, buf) {
  if (CONFIG.cache === 'off') return;
  memCache.set(key, { buf, ts: Date.now() });
  if (CONFIG.cache === 'disk') {
    try { fs.writeFileSync(path.join(CACHE_DIR, `${key}.mp3`), buf); } catch { /* best effort */ }
  }
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

// Turn a failed ElevenLabs response into a readable one-line message.
async function elevenErrorMessage(resp) {
  let body = '';
  try { body = await resp.text(); } catch { /* ignore */ }
  let detail = body;
  try {
    const j = JSON.parse(body);
    detail = typeof j.detail === 'string' ? j.detail : (j.detail?.message || body);
  } catch { /* not JSON */ }
  return `ElevenLabs ${resp.status}: ${detail || resp.statusText}`;
}

// Refuse to call ElevenLabs without a key, with a clear error.
function ensureKey(res) {
  if (!API_KEY) {
    res.status(503).json({ error: 'Brak klucza API. Ustaw ELEVENLABS_API_KEY (zobacz README) i zrestartuj serwer.' });
    return false;
  }
  return true;
}

const clamp = (n, lo, hi, dflt) => { n = Number(n); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

// --- Input validation for the ElevenLabs proxy ------------------------------
// ElevenLabs voice ids are short opaque alphanumeric handles; model ids look
// like "eleven_multilingual_v2". We only allow a conservative charset so a
// crafted value can't smuggle path segments or query string into the upstream
// URL (defense in depth on top of encodeURIComponent in synthesize()).
const VOICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MODEL_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const OUTPUT_FORMAT_RE = /^[A-Za-z0-9_]{1,32}$/; // e.g. mp3_44100_128

// Coerce to a trimmed string and enforce a max length. Returns '' for non-values.
function asBoundedString(v, max) {
  if (v == null) return '';
  const s = (typeof v === 'string' ? v : String(v)).trim();
  return s.length > max ? s.slice(0, max) : s;
}

// Validate/clamp client-supplied voice settings, falling back to defaults.
function sanitizeVoiceSettings(vs) {
  const d = CONFIG.defaultVoiceSettings;
  if (!vs || typeof vs !== 'object') return { ...d };
  return {
    stability: clamp(vs.stability, 0, 1, d.stability),
    similarity_boost: clamp(vs.similarity_boost ?? vs.similarityBoost, 0, 1, d.similarity_boost),
    style: clamp(vs.style, 0, 1, d.style),
    use_speaker_boost:
      typeof vs.use_speaker_boost === 'boolean' ? vs.use_speaker_boost
      : typeof vs.useSpeakerBoost === 'boolean' ? vs.useSpeakerBoost
      : d.use_speaker_boost,
  };
}

// ---------------------------------------------------------------------------
//  App
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by'); // don't advertise Express to attackers

// --- Basic security response headers (set manually; no helmet dependency) ----
// Applied to every response. The CSP is intentionally relaxed enough to keep
// the bundled web demo working: it uses inline <style>/<script> and plays audio
// from blob: URLs, and the relay talks over ws/wss. We still lock down framing,
// sniffing, referrer leakage and legacy XSS vectors.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-XSS-Protection', '0'); // modern guidance: disable buggy legacy auditor
  res.set('Cross-Origin-Resource-Policy', 'same-site');
  res.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=(self)');
  res.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",     // demo plays TTS from blob: URLs
      "style-src 'self' 'unsafe-inline'", // demo uses an inline <style>
      "script-src 'self' 'unsafe-inline'",// demo uses an inline <script>
      "connect-src 'self' ws: wss:",      // Socket.IO relay
    ].join('; ')
  );
  next();
});

app.use(express.json({ limit: '256kb' })); // parses JSON bodies for /api/tts (small JSON only)

// Permissive CORS for the local Expo WEB build (served from a different port) so
// it can call /api/* from the browser. Native apps don't need it; the API key
// stays server-side and no credentials/cookies are used, so '*' is safe here.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Turn body-parser failures (malformed JSON / payload too large) into a clean
// 4xx instead of a stack trace. Never echoes the offending body back.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Treść żądania zbyt duża.' });
  }
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: 'Nieprawidłowy JSON.' });
  }
  return next(err);
});

// GET /api/config — non-secret config the client needs.
app.get('/api/config', (req, res) => {
  res.json({
    participants: CONFIG.participants,
    ttsModels: CONFIG.ttsModels,
    ttsModelId: CONFIG.ttsModels.fallback, // back-compat for the web demo
    sttModelId: CONFIG.sttModelId,
    cache: CONFIG.cache,
    hasApiKey: Boolean(API_KEY),
  });
});

// GET /api/voices — premade voices the account can use via the API.
app.get('/api/voices', async (req, res) => {
  try {
    if (!ensureKey(res)) return;
    const r = await fetch(`${ELEVEN_API}/voices`, { headers: { 'xi-api-key': API_KEY } });
    if (!r.ok) return res.status(502).json({ error: await elevenErrorMessage(r) });
    const data = await r.json();
    const all = data.voices || [];
    const toEntry = (v) => ({ voice_id: v.voice_id, name: v.name, gender: (v.labels && v.labels.gender) || '', category: v.category });
    const premade = all.filter((v) => v.category === 'premade').map(toEntry);
    // The account's OWN voices (cloned via IVC, generated, or added from the
    // library) — always usable by the owner. Returned separately so the app can
    // surface "your voice" first (e.g. to hear your cloned voice in "Mów").
    const custom = all.filter((v) => v.category && v.category !== 'premade').map(toEntry);
    res.json({ premade, custom });
  } catch (err) {
    res.status(500).json({ error: 'Błąd serwera (voices): ' + (err?.message || err) });
  }
});

// ===========================================================================
//  Text-to-Speech  —  POST /api/tts  and  GET /api/tts
//  ---- ElevenLabs Text-to-Speech call -------------------------------------
//  Synthesizes one message in the given voice. `text` may contain eleven_v3
//  audio tags like "[happy]" — passed through untouched. Cached by
//  (voiceId + model + format + settings + text).
//    • POST (JSON body): used by the web demo and rich clients.
//    • GET  (query params): lets a native audio player STREAM the URL directly,
//      which is far simpler/robust on React Native than handling binary in JS.
// ===========================================================================
async function synthesize({ text, voiceId, modelId, outputFormat, voiceSettings }) {
  const key = cacheKey([voiceId, modelId, outputFormat, JSON.stringify(voiceSettings), text]);
  const cached = cacheGet(key);
  if (cached) return { audio: cached, cache: 'HIT' };

  // Docs: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
  const url = `${ELEVEN_API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: modelId, voice_settings: voiceSettings }),
  });
  if (!r.ok) { const e = new Error(await elevenErrorMessage(r)); e.status = 502; throw e; }
  const audio = Buffer.from(await r.arrayBuffer());
  cacheSet(key, audio);
  return { audio, cache: 'MISS' };
}

async function handleTts(res, { text, voiceId, modelId, outputFormat, voiceSettings }) {
  if (!text || !voiceId) return res.status(400).json({ error: 'Wymagane pola: text oraz voiceId.' });
  // text is the only field intended to vary freely; cap its length (already a
  // contract) and coerce to string so a non-string can't reach the upstream.
  text = String(text);
  if (text.length > 5000) return res.status(400).json({ error: 'Tekst zbyt długi (max 5000 znaków).' });

  // Strict format checks on the proxy parameters. These ids are opaque handles;
  // anything outside the allowed charset is a malformed request, not content.
  voiceId = String(voiceId);
  if (!VOICE_ID_RE.test(voiceId)) return res.status(400).json({ error: 'Nieprawidłowy voiceId.' });
  if (modelId != null && modelId !== '' && !MODEL_ID_RE.test(String(modelId))) {
    return res.status(400).json({ error: 'Nieprawidłowy modelId.' });
  }
  if (outputFormat != null && outputFormat !== '' && !OUTPUT_FORMAT_RE.test(String(outputFormat))) {
    return res.status(400).json({ error: 'Nieprawidłowy outputFormat.' });
  }
  try {
    const { audio, cache } = await synthesize({
      text,
      voiceId,
      modelId: modelId || CONFIG.ttsModels.fallback,     // multilingual / v3 / flash
      outputFormat: outputFormat || CONFIG.ttsOutputFormat,
      voiceSettings: sanitizeVoiceSettings(voiceSettings),
    });
    res.set('Content-Type', 'audio/mpeg');
    res.set('X-Cache', cache);
    res.send(audio);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || ('Błąd serwera (TTS): ' + err) });
  }
}

app.post('/api/tts', async (req, res) => {
  if (!ensureKey(res)) return;
  const b = req.body || {};
  await handleTts(res, { text: b.text, voiceId: b.voiceId, modelId: b.modelId, outputFormat: b.outputFormat, voiceSettings: b.voiceSettings });
});

app.get('/api/tts', async (req, res) => {
  if (!ensureKey(res)) return;
  const q = req.query;
  const usb = q.use_speaker_boost; // string -> boolean | undefined
  await handleTts(res, {
    text: q.text,
    voiceId: q.voiceId,
    modelId: q.modelId,
    outputFormat: q.outputFormat,
    voiceSettings: {
      stability: q.stability,
      style: q.style,
      similarity_boost: q.similarity_boost,
      use_speaker_boost: usb === 'true' ? true : usb === 'false' ? false : undefined,
    },
  });
});

// ===========================================================================
//  POST /api/stt   body: raw audio bytes (e.g. audio/webm)   ->   { text }
//  ---- ElevenLabs Scribe Speech-to-Text call ------------------------------
//  Transcribes a spoken reply. Reads the raw body (no upload library) and
//  rebuilds it as multipart for ElevenLabs.
// ===========================================================================
app.post('/api/stt', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  try {
    if (!ensureKey(res)) return;
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Brak danych audio.' });

    const contentType = req.headers['content-type'] || 'audio/webm';
    const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('ogg') ? 'ogg' : 'webm';

    // Docs: POST https://api.elevenlabs.io/v1/speech-to-text  (model_id, file, language_code)
    const form = new FormData();
    form.append('model_id', CONFIG.sttModelId);
    if (CONFIG.sttLanguage) form.append('language_code', CONFIG.sttLanguage);
    form.append('file', new Blob([req.body], { type: contentType }), `reply.${ext}`);

    const elevenResp = await fetch(`${ELEVEN_API}/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': API_KEY }, // do NOT set Content-Type: fetch adds the boundary
      body: form,
    });

    if (!elevenResp.ok) return res.status(502).json({ error: await elevenErrorMessage(elevenResp) });
    const data = await elevenResp.json();
    res.json({ text: (data.text || '').trim() });
  } catch (err) {
    res.status(500).json({ error: 'Błąd serwera (STT): ' + (err?.message || err) });
  }
});

// ===========================================================================
//  POST /api/emotion   body: raw audio bytes   ->   { emotion, intensity, raw }
//  ---- Speech Emotion Recognition (emotion from VOICE, not text) ----------
//  Proxies the recorded audio to the local emotion2vec microservice
//  (emotion-service/, FunASR). Lets a DICTATED message take its emotion from
//  HOW it was spoken. If the service isn't running, returns 503 so the app
//  gracefully falls back to text-based emotion.
// ===========================================================================
app.post('/api/emotion', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'Brak danych audio.' });
  const service = process.env.EMOTION_SERVICE_URL || 'http://127.0.0.1:8200';
  try {
    const r = await fetch(`${service}/emotion`, {
      method: 'POST',
      headers: { 'Content-Type': req.headers['content-type'] || 'application/octet-stream' },
      body: req.body,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: data.error || 'Serwis emocji zwrócił błąd.' });
    res.json(data); // { emotion, intensity, raw }
  } catch (err) {
    // Service unreachable → 503; the app falls back to text emotion.
    res.status(503).json({ error: 'Serwis emocji niedostępny (uruchom emotion-service).' });
  }
});

// ===========================================================================
//  POST /api/voices/add?name=...   body: raw audio sample (1-2 min)  -> { voiceId }
//  ---- ElevenLabs Instant Voice Cloning (IVC) -----------------------------
//  Forwards a recorded sample to ElevenLabs to create a cloned voice.
//  REQUIRES A PAID ElevenLabs PLAN — a free key gets a clear 402 here.
// ===========================================================================
app.post('/api/voices/add', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  try {
    if (!ensureKey(res)) return;
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Brak próbki audio.' });

    // Strip control chars from the user-supplied voice name and cap its length;
    // it is the only free-form field we forward to the cloning endpoint.
    const name = asBoundedString(req.query.name, 80).replace(/[\x00-\x1F\x7F]/g, '') || 'VoiceThread Voice';
    const contentType = req.headers['content-type'] || 'audio/webm';
    const ext = contentType.includes('mp3') || contentType.includes('mpeg') ? 'mp3'
              : contentType.includes('mp4') || contentType.includes('m4a') ? 'm4a'
              : contentType.includes('wav') ? 'wav'
              : 'webm';

    // Docs: POST https://api.elevenlabs.io/v1/voices/add  (multipart: name, files[])
    const form = new FormData();
    form.append('name', name);
    form.append('files', new Blob([req.body], { type: contentType }), `sample.${ext}`);

    const elevenResp = await fetch(`${ELEVEN_API}/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': API_KEY },
      body: form,
    });

    if (!elevenResp.ok) {
      const msg = await elevenErrorMessage(elevenResp);
      // A free key cannot clone -> give a friendly, actionable error.
      // ElevenLabs may signal this as 401/403 OR as a 400 whose message mentions
      // the subscription/upgrade, so detect both.
      const planIssue = elevenResp.status === 401 || elevenResp.status === 403
        || /subscription|voice cloning|upgrade your plan/i.test(msg);
      if (planIssue) {
        return res.status(402).json({ error: 'Klonowanie głosu wymaga płatnego planu ElevenLabs. Na razie użyj głosu premade. (' + msg + ')' });
      }
      return res.status(502).json({ error: msg });
    }

    const data = await elevenResp.json();
    res.json({ voiceId: data.voice_id, name, requiresVerification: !!data.requires_verification });
  } catch (err) {
    res.status(500).json({ error: 'Błąd serwera (klonowanie): ' + (err?.message || err) });
  }
});

// Serve the bundled web demo (and anything else in /public).
app.use(express.static(path.join(__dirname, 'public')));

// ===========================================================================
//  Socket.IO — real-time message relay between two paired devices.
//  The server RELAYS and FORGETS: message content is never stored or logged.
//  A "room" is a pairing code shared by the two people in a conversation.
// ===========================================================================
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CONFIG.corsOrigin },
  // Cap the size of any single engine.io frame so a malicious client cannot
  // push a multi-megabyte "message" through the relay (defense in depth on top
  // of the per-event size check below).
  maxHttpBufferSize: CONFIG.relay.socketMaxHttpBufferSize,
});

const rooms = new Map(); // roomId -> Map<socketId, { userId, displayName }>

// Roughly size a value as it would be serialized on the wire, without keeping
// the string around. Used only to REJECT oversized payloads — content is never
// inspected, stored or logged.
function approxByteSize(v) {
  try { return Buffer.byteLength(JSON.stringify(v) || '', 'utf8'); }
  catch { return Infinity; } // circular / non-serializable -> treat as too big
}

io.on('connection', (socket) => {
  // crude per-socket token-bucket rate limit for the 'message' event
  let tokens = CONFIG.relay.msgRateLimit.points;
  const refill = setInterval(() => { tokens = CONFIG.relay.msgRateLimit.points; }, CONFIG.relay.msgRateLimit.perMs);

  socket.on('join', (data = {}) => {
    if (!data || typeof data !== 'object') {
      return socket.emit('error', { code: 'bad_room', message: 'roomId i userId są wymagane.' });
    }
    // Coerce + bound every field, then enforce a strict charset on the ids so a
    // room/pairing code can't carry control chars or unbounded unicode.
    const roomId = asBoundedString(data.roomId, CONFIG.relay.maxRoomIdLen);
    const userId = asBoundedString(data.userId, CONFIG.relay.maxUserIdLen);
    const displayName = asBoundedString(data.displayName, CONFIG.relay.maxDisplayNameLen);
    if (!roomId || !userId) {
      return socket.emit('error', { code: 'bad_room', message: 'roomId i userId są wymagane.' });
    }
    if (!CONFIG.roomIdPattern.test(roomId) || !CONFIG.userIdPattern.test(userId)) {
      return socket.emit('error', { code: 'bad_room', message: 'Nieprawidłowy roomId lub userId.' });
    }

    let room = rooms.get(roomId);
    if (!room) { room = new Map(); rooms.set(roomId, room); }
    if (room.size >= CONFIG.relay.maxRoomMembers && !room.has(socket.id)) {
      return socket.emit('error', { code: 'room_full', message: 'Pokój jest pełny (maks. 2 osoby).' });
    }

    socket.data = { roomId, userId, displayName };
    room.set(socket.id, { userId, displayName });
    socket.join(roomId);

    socket.emit('joined', { roomId, you: userId, members: [...room.values()] });
    socket.to(roomId).emit('peer_joined', { userId, displayName });
  });

  // Relay a chat message to the OTHER member(s). No echo to sender, no storage.
  // The payload is treated as OPAQUE: we never read its content beyond the `id`
  // used for the delivery ack, never log it, never persist it. We only gate on
  // identity (must have joined), rate, type and SIZE.
  socket.on('message', (payload) => {
    // Token-bucket rate limit; clamp so a flood can't drive the counter to -∞.
    if (tokens <= 0) return socket.emit('error', { code: 'rate_limited', message: 'Zbyt wiele wiadomości.' });
    tokens--;

    const roomId = socket.data?.roomId;
    if (!roomId) return; // not joined -> ignore silently
    if (!payload || typeof payload !== 'object') {
      return socket.emit('error', { code: 'bad_message', message: 'Nieprawidłowa wiadomość.' });
    }
    if (approxByteSize(payload) > CONFIG.relay.maxMessageBytes) {
      return socket.emit('error', { code: 'message_too_large', message: 'Wiadomość zbyt duża.' });
    }

    socket.to(roomId).emit('message', payload);
    // Bound the id we echo back so a crafted id can't bloat the ack.
    const messageId = asBoundedString(payload.id, CONFIG.relay.maxMessageIdLen);
    socket.emit('delivered', { messageId, by: 'server' });
  });

  socket.on('typing', ({ isTyping } = {}) => {
    const roomId = socket.data?.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('typing', { userId: socket.data.userId, isTyping: !!isTyping });
  });

  socket.on('delivered', ({ messageId } = {}) => {
    const roomId = socket.data?.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('delivered', { messageId: asBoundedString(messageId, CONFIG.relay.maxMessageIdLen), by: socket.data.userId });
  });

  socket.on('played', ({ messageId } = {}) => {
    const roomId = socket.data?.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('played', { messageId: asBoundedString(messageId, CONFIG.relay.maxMessageIdLen), by: socket.data.userId });
  });

  const cleanup = () => {
    clearInterval(refill);
    const roomId = socket.data?.roomId;
    const room = roomId && rooms.get(roomId);
    if (room) {
      room.delete(socket.id);
      socket.to(roomId).emit('peer_left', { userId: socket.data?.userId });
      if (room.size === 0) rooms.delete(roomId);
    }
  };
  socket.on('leave', () => { const r = socket.data?.roomId; cleanup(); if (r) socket.leave(r); });
  socket.on('disconnect', cleanup);
});

// Keep the relay alive if a single async handler rejects/throws. We log a
// generic marker only — NEVER the error payload, so message content or the API
// key can never reach the logs through an error path.
process.on('unhandledRejection', () => { console.error('  ⚠  unhandledRejection (suppressed; not logging payload)'); });
process.on('uncaughtException',  () => { console.error('  ⚠  uncaughtException (suppressed; not logging payload)'); });

httpServer.listen(CONFIG.port, () => {
  console.log(`\n  VoiceThread  →  http://localhost:${CONFIG.port}`);
  console.log(`  Socket.IO relay ready • cache: ${CONFIG.cache}\n`);
  if (!API_KEY) {
    console.log('  ⚠  ELEVENLABS_API_KEY is not set — TTS/STT/cloning will return an error.');
    console.log('     Set it (see README) and restart the server.\n');
  } else {
    console.log('  ✓  API key detected. Ready.\n');
  }
});
