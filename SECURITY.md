# VoiceThread — Security & Privacy Notes

VoiceThread is a **proof-of-concept** voice-first messenger built as an ElevenLabs
showcase. This document describes the security posture of the **backend**
(`server.js`): what it protects, what it deliberately does **not** yet protect,
and the honest privacy story. It is scoped to the PoC — it is **not** a claim of
production readiness.

The backend does two things:

1. **Proxies all ElevenLabs API calls** so the API key never reaches a client.
2. **Relays chat messages** between two paired devices over Socket.IO, in memory,
   never storing message content.

---

## 1. Threat model

### Assets we protect
- **The ElevenLabs API key** — the single high-value secret. It lives only in the
  `ELEVENLABS_API_KEY` env var on the server and is the primary thing an attacker
  would want (it maps directly to billable quota).
- **Backend availability** — the relay/proxy should not be trivially crashed or
  starved by a single misbehaving client.
- **Message content in transit through our relay** — we minimize what we can
  touch and guarantee we never persist it.

### What is explicitly *not* an asset here
- There are **no user accounts, passwords, sessions, or cookies**. There is no
  database. The server stores no personal data at rest (see the data table).
- Pairing/room codes are **bearer capabilities** for a transient conversation,
  not authenticated identities (see "Remaining risks").

### Adversaries considered
| Adversary | Capability | Our mitigation |
|---|---|---|
| **Malicious / buggy client** | Sends crafted, oversized, or malformed HTTP bodies and socket events | Strict input validation, size caps, type coercion, rate limiting, error handlers that never crash the process |
| **Curious client** | Wants the API key | Key is server-side only; never sent to clients, never logged, never echoed in errors |
| **Eavesdropper on the wire** | Reads traffic | Out of scope for the PoC over plain HTTP/WS on localhost; **TLS is required for any real deployment** (see next steps) |
| **Eavesdropper at ElevenLabs** | Sees text we forward for synthesis/transcription | Disclosed honestly (we do **not** claim zero-retention); only transient text leaves the device, emotion is computed on-device |
| **Cross-site attacker** (in a browser) | Tries to drive the API from another origin, frame the page, or sniff content types | CORS posture documented below; security response headers (CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) |

### Trust boundaries
```
[ mobile app / web demo ]  --HTTP/WS-->  [ VoiceThread backend ]  --HTTPS-->  [ ElevenLabs API ]
        (untrusted input)                  (holds the API key,                  (3rd party; sees
                                            relays + forgets)                    transient text/audio)
```
All input crossing the first boundary is treated as **untrusted** and validated
before use. The API key never crosses the first boundary in either direction.

---

## 2. What data touches the server, and for how long

"Persisted" = written to disk or a database. The default configuration persists
**nothing** related to message content.

| Data | Where | Retention | Persisted? | Notes |
|---|---|---|---|---|
| ElevenLabs **API key** | Server process env (`ELEVENLABS_API_KEY`) | Process lifetime | No (env only) | Never sent to clients, never logged, never in error bodies |
| **Message content** (text / ciphertext) | RAM, for the duration of one relay hop | Milliseconds (forward then discard) | **No** | Relayed opaquely; never inspected beyond size, never stored, never logged |
| **Room / pairing code, userId, displayName** | RAM (`rooms` Map) | Until the last member leaves/disconnects, then the room entry is deleted | **No** | In-memory only; gone on restart |
| **TTS audio (mp3)** | Cache | `CONFIG.cache` mode: `memory` (default) = RAM only, TTL 30 min; `disk` = `./.cache`; `off` = none | Only if `cache: 'disk'` | Default `'memory'` writes **nothing to disk**. Cache key is a SHA-1 of voice+model+format+settings+**text**, so the source text is *not* recoverable from the key, but identical text yields identical audio while cached |
| **Uploaded audio** (STT / voice-clone sample) | RAM, streamed to ElevenLabs | Duration of the request | **No** | Read as a raw body and forwarded; not stored on our side |
| **Logs** | stdout | Operator-controlled | Process only | Only connection/startup lines + whether a key is present (boolean). **No message content, no API key, no error payloads** |

**Cache audit result:** with the default `cache: 'memory'`, message text produces
audio that lives only in RAM with a 30-minute TTL and is never written to disk.
Setting `cache: 'disk'` is an explicit opt-in that persists **audio** (not text)
to `./.cache`; operators should understand that trade-off before enabling it.

---

## 3. Honest privacy statement

VoiceThread uses a **hybrid** privacy model:

- **Emotion is computed entirely on-device** (`voicethread-app/src/features/emotion/`).
  Raw analysis of your text for tone never leaves your phone.
- **Only the text to be spoken is sent transiently to ElevenLabs** for synthesis
  (and, for spoken replies, audio is sent for transcription). This is inherent to
  using a cloud TTS/STT provider.
- **Our relay stores nothing.** Message content passes through memory and is
  forwarded to the peer, never written to disk or a database by us.

**We do _not_ claim "zero-retention."** Zero-retention processing at ElevenLabs is
an Enterprise-only arrangement that this PoC is not configured for. We are honest
that text/audio you send for synthesis or transcription is processed by
ElevenLabs under their terms and data-retention policy. If end-to-end privacy
against the provider is a requirement, that needs the Enterprise zero-retention
tier and/or the E2E encryption work described below.

---

## 4. Hardening implemented in this PoC (`server.js`)

All of the following preserve existing endpoint/socket contracts.

### API-key handling
- Key is read once from `process.env.ELEVENLABS_API_KEY` and sent only to
  ElevenLabs via the `xi-api-key` header. It is **never** returned to a client,
  **never** logged, and **never** included in an error message (error helper only
  reads the *response* body, never request headers).

### HTTP input validation & limits (the ElevenLabs proxy)
- JSON body limit reduced to **256 KB** for `/api/*` JSON (these endpoints only
  ever carry small JSON). Audio-upload endpoints keep their 25 MB raw limit.
- Malformed JSON and oversized bodies are caught by a dedicated error handler and
  returned as a clean **400 / 413** — never a stack trace, never the offending
  body echoed back.
- `/api/tts`: `voiceId`, `modelId`, and `outputFormat` are validated against
  strict allow-list character classes (opaque-handle charset only), so a crafted
  value cannot smuggle path segments or query strings into the upstream URL
  (defense in depth on top of `encodeURIComponent`). `text` is coerced to a
  string and remains capped at 5000 chars.
- `/api/voices/add`: the user-supplied voice `name` is length-capped (80) and
  stripped of ASCII control characters before being forwarded.

### Socket.IO relay validation & limits
- Every inbound event payload is coerced and bounded; non-object payloads are
  rejected with a typed `error` event.
- **Room/pairing code and userId** must match a strict charset
  (`[A-Za-z0-9._:-]`, ≤ 64 chars); `displayName` is length-bounded.
- **Per-message size cap** (~48 KB serialized) plus an engine.io
  `maxHttpBufferSize` frame cap (64 KB) reject oversized/flood frames before they
  reach the peer.
- **Rate limiting** is a per-socket token bucket (30 messages / 10 s), now
  clamped so a flood cannot drive the counter negative and bypass the limit.
- Rooms are still hard-capped at **2 members** and message content is relayed
  **opaquely** — never inspected beyond size, never logged, never stored.

### Response headers (set manually; no `helmet` dependency)
Applied to every response:
- `Content-Security-Policy` — locks `default-src`, `object-src 'none'`,
  `frame-ancestors 'none'`, `base-uri 'self'`. Intentionally allows inline
  `script`/`style`, `blob:`/`data:` media, and `ws:`/`wss:` connect so the
  bundled web demo (inline scripts/styles, blob-URL audio, Socket.IO) keeps
  working. Tightening to nonce-based CSP is a future step.
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Resource-Policy: same-site`
- `Permissions-Policy: geolocation=(), camera=(), microphone=(self)`
- `X-XSS-Protection: 0` (modern guidance — the legacy auditor is itself a risk)
- `X-Powered-By` disabled (don't advertise the framework).

### Availability
- Process-level `unhandledRejection` / `uncaughtException` guards keep the relay
  alive if a single async handler throws, and log only a generic marker —
  **never** the error payload (so content/key cannot leak via an error path).

---

## 5. CORS posture

- **Default (`CORS_ORIGIN` unset): permissive `*`.** This is acceptable **for a
  local prototype** specifically because the server holds **no cookies, no
  sessions, and no per-user data**, and the only secret (the API key) never
  leaves the server. A permissive origin therefore grants an attacker nothing
  they could not get by calling the proxy directly — there is no ambient
  authority to ride on (no CSRF surface, since there is nothing to forge a
  session for).
- **For any real deployment**, set `CORS_ORIGIN` to a comma-separated allow-list
  of trusted origins (e.g. `CORS_ORIGIN=https://app.example.com`). The code reads
  this env var and applies it to both Express responses' origin policy
  (via the headers above) and the Socket.IO CORS config.

---

## 6. Client review — chat wiring in `App.js` (milestone 2)

Security review of the mobile client's chat integration (`voicethread-app/App.js`,
`src/api/socket.js`). The client is **untrusted input** to the relay; the relay's
own validation (§4) is the real control. This section records that the client
introduces no *new* secret-handling or injection surface.

- **Pairing code → `roomId`.** The user-typed code is `code.trim()` (App.js) and
  emitted as `roomId` via `relay.join` → `socket.emit('join', …)`. It is **not**
  validated client-side, which is fine: the server enforces
  `roomIdPattern = /^[A-Za-z0-9._:-]{1,64}$/` and length cap (§4) and rejects
  anything else with a typed `bad_room` error. **No roomId-injection risk** — the
  room id is only ever a `Map` key (`rooms.get(roomId)`) and a Socket.IO room
  name, never interpolated into a URL, filesystem path, query, or shell. **DoS:**
  bounded by the 2-member room cap, the per-socket token bucket (30 msg/10 s), the
  per-message (~48 KB) and engine.io frame (64 KB) caps. A client can create many
  distinct rooms, but each is GC'd when its last member leaves — same residual
  "no per-IP connection quota" gap already tracked in §7 (next steps), not new.
- **Voice IDs are not credentials.** `myVoiceId` / `contactVoiceId` are the opaque
  ElevenLabs voice handles selected from `GET /api/voices`. They are passed as
  props to `ChatScreen` and ultimately reach `GET /api/tts?voiceId=…`, where the
  server re-validates them against `VOICE_ID_RE` and `encodeURIComponent`s them
  into the upstream URL. They are **never** used as auth tokens, never grant
  access to a room, and are not persisted to device storage (no
  AsyncStorage/SecureStore/file writes anywhere in the client). Worst case, a
  crafted voice id is a malformed `/api/tts` request the server rejects.
- **Display name is user-controlled.** `displayName` is `name.trim() || 'Ja'`
  from a free-text `TextInput` — it is **not** derived from device identifiers
  (no IMEI/`Device`/`Application`/OS-version APIs are imported or used). The
  `userId` is a random ephemeral `u-<base36>` minted per session
  (`Math.random()`), not a hardware id. Both are length-bounded server-side. No
  involuntary device-fingerprint PII leaves the phone.
- **No secrets in client code.** Confirmed: the ElevenLabs key is never
  referenced client-side. No `.env` file ships in `voicethread-app/`, and a scan
  of `voicethread-app/src/**` for `API_KEY|apiKey|xi-api-key|process.env|Bearer|
  secret` matches **only comments** that name "ElevenLabs" (e.g. "sent transiently
  to ElevenLabs"). The client's only backend reference is the auto-detected
  `http://<host>:3000` base URL (non-secret). All ElevenLabs calls remain proxied
  through the server.
- **Dependency spot-check.** `socket.io-client@^4.8.1` — no known CVE; the only
  newer release in the line is `4.8.3`, a routine maintenance bump (no security
  advisory). Bumping the caret to pick it up is optional hygiene, not a fix. (The
  general `npm audit`/lockfile gate remains a documented next step.)

**Verdict: all clear.** The chat wiring adds no new client-side secret handling
and no injection/DoS surface beyond what the relay already validates and what is
already tracked below.

---

## 7. Remaining risks & next steps

This is a PoC; the following are **known gaps**, roughly in priority order.

1. **No transport encryption by default.** Plain HTTP/WS is fine on localhost but
   exposes content to network eavesdroppers in any real deployment.
   **Next step:** terminate TLS (HTTPS/WSS) at a reverse proxy or directly, and
   send HSTS.
2. **No end-to-end encryption (E2E).** Today the relay *could* read message text
   in transit (it chooses not to, and stores nothing), and ElevenLabs sees the
   text it synthesizes. The wire payload already reserves a
   `ciphertext`/`nonce` seam (`{ id, roomId, from, text? | (ciphertext?+nonce?),
   ts, emotion?, v:1 }`) so E2E can drop in **without changing the relay**.
   **Next step:** client-side key exchange (e.g. X25519) + authenticated
   encryption (e.g. XChaCha20-Poly1305) per conversation, so the relay only ever
   sees ciphertext. Note: cloud TTS still requires plaintext at synthesis time —
   true provider-blind voice would need on-device TTS or the ElevenLabs
   Enterprise zero-retention tier.
3. **Pairing codes are unauthenticated bearer capabilities.** Anyone who learns a
   room code can join (up to the 2-member cap) and the room-full check is a weak
   anti-takeover guard. There is no proof a participant is who they claim.
   **Next steps:** high-entropy, single-use, expiring codes; a join handshake;
   and identity/key pinning once E2E lands.
4. **In-memory rate limiting & rooms do not survive scaling.** The token bucket
   and `rooms` map are per-process. Behind multiple instances they would need a
   shared store (e.g. Redis) and a sticky/relayed adapter for Socket.IO.
5. **No abuse/quota controls on the ElevenLabs proxy.** A client with network
   access to the server can spend ElevenLabs credits via `/api/tts` and `/api/stt`
   (cloning needs a paid plan and already returns a friendly 402). The cache
   blunts repeated identical text, but there is no per-client quota or auth.
   **Next steps:** authenticate proxy callers, add per-client quotas, and
   consider request signing.
6. **Relaxed CSP.** The current policy allows `'unsafe-inline'` to keep the demo
   working. **Next step:** move the web demo to external scripts/styles with CSP
   nonces or hashes and drop `'unsafe-inline'`.
7. **Dependency & supply-chain hygiene.** Out of scope for this file but worth a
   `npm audit` gate and lockfile review before any production use.

---

*Scope note: this document covers the backend. The on-device emotion module is
designed to keep tone analysis local; client-side storage of message history (if
any) is the responsibility of the mobile app and is out of scope here.*
