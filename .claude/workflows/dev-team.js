export const meta = {
  name: 'voicethread-dev-team',
  description: 'VoiceThread dev team: Security, QA/Tests, UX/UI and Features agents each own DISJOINT files and do one coordinated pass in parallel; then adversarial review + automated tests (npm test) + Expo bundle check.',
  phases: [
    { title: 'Team', detail: 'Security, Tests, UX/UI, Features — disjoint file ownership, parallel' },
    { title: 'Review & Verify', detail: 'Adversarial review + npm test + emotion test + Expo bundle check' },
  ],
};

const REPO = 'C:/Users/frani/Uczelnia/SMS';

const LANE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lane', 'filesChanged', 'summary'],
  properties: {
    lane: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', description: 'What you changed and why, concise.' },
    testsAdded: { type: 'array', items: { type: 'string' } },
    risks: { type: 'string' },
    wiringNotes: { type: 'string', description: 'How to integrate this later, if applicable.' },
  },
};

const CONTEXT = `
PROJECT: "VoiceThread" — a voice-first messenger PoC, built as an ElevenLabs side project / showcase. Quality and correctness matter; keep it minimal (PoC), do NOT over-engineer, do NOT add heavy dependencies.
Repo root: ${REPO}
- Backend: ${REPO}/server.js — Express + Socket.IO. Proxies ALL ElevenLabs calls (API key in env var, NEVER sent to client). HTTP: GET /api/config, GET /api/voices, POST & GET /api/tts (cached by voice+model+settings+text), POST /api/stt (Scribe), POST /api/voices/add (Instant Voice Cloning, needs paid plan). Socket.IO relay events: client->server join/message/typing/delivered/played/leave ; server->client joined/peer_joined/peer_left/message/typing/delivered/played/error. Rooms are IN-MEMORY, max 2, and MESSAGE CONTENT IS NEVER STORED. Helpers already present: ensureKey(), elevenErrorMessage(), sanitizeVoiceSettings(), synthesize(), cache modes (CONFIG.cache, default 'memory').
- Web demo: ${REPO}/public/index.html (must keep working).
- Mobile app: ${REPO}/voicethread-app (Expo SDK 56 + React Native). Entry App.js = "milestone 1" screen: type a message -> on-device emotion -> GET /api/tts -> expo-audio playback; auto-detects backend from Expo Constants hostUri at port 3000. On-device emotion module: ${REPO}/voicethread-app/src/features/emotion/ (classifyEmotion.js, emotionToSynthesis.js, lexicons.js, index.js; helper analyzeForSpeech(text) returns {emotion,intensity,confidence,tags,modelId,voiceSettings,ttsText}).
PRIVACY (hybrid): emotion computed on-device; only text sent transiently to ElevenLabs; relay stores nothing; do NOT claim zero-retention (Enterprise-only).
HARD RULES (all agents):
- Edit ONLY the files listed in YOUR lane. Other agents edit other files in parallel — do NOT touch theirs.
- Do NOT run "npm install", do NOT start servers, do NOT run tests or long processes. Only write files. (A separate CI step verifies later.)
- Preserve ALL existing behavior and contracts (endpoints, socket events, app features, web demo). No breaking changes.
- Keep the ElevenLabs API key server-side only; never log it.

OPERATING PRINCIPLES (best practices applied to every agent): read before write & reuse existing patterns (start wide, then narrow); small, safe diffs that preserve contracts (milestone-1 must keep working AND bundling); work to clear acceptance criteria and SELF-VERIFY before finishing; privacy-by-design (emotion on-device, relay stores nothing, key server-side); be transparent about decisions + risks; minimal & correct over clever (PoC, no heavy deps).
`;

phase('Team');
const lanes = await parallel([
  () => agent(`${CONTEXT}
YOU ARE THE SECURITY ENGINEER.
Edit ONLY: ${REPO}/server.js  and a NEW file ${REPO}/SECURITY.md.  Do NOT add dependencies (use plain code, no helmet).
Harden the relay + proxy WITHOUT breaking contracts: validate/sanitize every Socket.IO payload and the room code (length + allowed charset), enforce a max message/payload size, harden the per-socket rate limit, validate /api/tts & /api/voices/add inputs (voiceId/model format checks; text length is already capped), reject malformed/oversized input safely, ensure the API key is never logged, confirm no message content is persisted anywhere (audit the cache: default 'memory'), add basic security HTTP response headers manually, and note CORS posture for a prototype. SECURITY.md: threat model, a table of what data touches the server and for how long, the honest privacy statement, and remaining risks + next steps (E2E encryption). Return what you changed.`,
    { label: 'security', phase: 'Team', agentType: 'general-purpose', schema: LANE_SCHEMA }),

  () => agent(`${CONTEXT}
YOU ARE THE QA / TEST ENGINEER.
Create/edit ONLY: a NEW ${REPO}/tests/ directory and the ROOT ${REPO}/package.json (add a "test" script; keep existing scripts & deps intact — socket.io-client is already a devDependency). Do NOT edit server.js or any app file. Do NOT run the tests or start any server (the CI step runs them).
Build an AUTOMATED suite runnable via "npm test" using Node's built-in runner (node:test + node:assert, NO new deps):
 (a) a helper that spawns the backend as a child process on TEST port 3099 (child_process.spawn, env PORT=3099), polls GET http://localhost:3099/api/config until ready, and reliably kills it afterwards on Windows (e.g. taskkill /T or tree-kill via pid) in test teardown;
 (b) Socket.IO relay tests with socket.io-client (transports:['websocket']): join, message relays to the peer, sender gets NO echo, delivered receipt, typing relay, room_full on a 3rd joiner, peer_left on disconnect;
 (c) /api/tts and /api/voices/add VALIDATION tests that do NOT call ElevenLabs (missing fields -> 400; over-long text -> 400) so the suite spends ZERO credits and needs no API key;
 (d) make "npm test" ALSO run the on-device emotion tests (node ${REPO}/voicethread-app/src/features/emotion/emotion.test.mjs).
"npm test" must exit non-zero on any failure. Keep it deterministic and fast. Return the exact command(s) to run.`,
    { label: 'tests', phase: 'Team', agentType: 'general-purpose', schema: LANE_SCHEMA }),

  () => agent(`${CONTEXT}
YOU ARE THE UX/UI DESIGNER + ENGINEER.
Edit/create ONLY: ${REPO}/voicethread-app/App.js, a NEW ${REPO}/voicethread-app/src/theme.js, and a NEW ${REPO}/voicethread-app/UX.md. Do NOT edit package.json, do NOT add dependencies, do NOT edit server.js, the emotion module, or any other src file.
Extract a small design system into theme.js (colors, spacing, radius, typography) and refactor App.js to use it, while POLISHING the milestone-1 screen: clearer hierarchy, larger eyes-free tap targets, better contrast + accessibility (accessibilityLabel/Role on controls), a visible loading/playing state on the "Mów" button, graceful empty + error states. KEEP all current behavior: auto-detect BACKEND from Expo hostUri:3000, fetch /api/voices, live emotion via ./src/features/emotion, speak() calling GET /api/tts via expo-audio. Stay Expo SDK 56 / RN compatible with NO new deps and Metro-clean. UX.md: design rationale + an eyes-free UX plan for the upcoming hands-free + driving modes. Return what you changed.`,
    { label: 'ux-ui', phase: 'Team', agentType: 'general-purpose', schema: LANE_SCHEMA }),

  () => agent(`${CONTEXT}
YOU ARE THE FEATURES ENGINEER.
Create ONLY NEW files under ${REPO}/voicethread-app/src/ : src/api/socket.js, src/features/chat/useChat.js, src/features/chat/ChatScreen.js ; and add "socket.io-client" to ${REPO}/voicethread-app/package.json dependencies (that one file edit only). Do NOT modify App.js (UX owns it), server.js, the emotion module, or theme.js (created in parallel — do NOT import it; use self-contained styles).
Build the milestone-2 building blocks for real 2-phone chat over the EXISTING Socket.IO relay:
 (1) src/api/socket.js — a socket.io-client wrapper (transports:['websocket']; backend URL auto-derived from expo-constants hostUri at port 3000) exposing connect(), join(roomId,user), sendMessage(payload), onMessage(cb), onPeer(cb), typing(isTyping), disconnect();
 (2) src/features/chat/useChat.js — a React hook holding the message list + relay wiring + per-contact voiceId, that PLAYS incoming messages via the on-device emotion module (import analyzeForSpeech from '../emotion') + GET /api/tts + expo-audio;
 (3) src/features/chat/ChatScreen.js — an iMessage-style chat screen (left/right bubbles, text input, send, per-bubble ▶ play) using the hook; self-contained styles (no theme import).
Must be Metro-clean. Provide wiringNotes describing how App.js will mount ChatScreen later. Return what you changed.`,
    { label: 'features', phase: 'Team', agentType: 'general-purpose', schema: LANE_SCHEMA }),
]);

const done = lanes.filter(Boolean);
log(`Team finished lanes: ${done.map((l) => l.lane).join(', ')}`);

phase('Review & Verify');
const changed = done.flatMap((l) => l.filesChanged || []).join('\n');
const [review, verify] = await parallel([
  () => agent(`${CONTEXT}
YOU ARE THE STAFF REVIEWER (read-only). Adversarially review the team's work for: broken contracts/regressions, security holes, privacy leaks (message persistence, key leakage), React Native / Expo incompatibility, and plain bugs. Read these changed files plus server.js, App.js, the new tests/, and the new chat modules:
${changed}
Return a concise, prioritized list: each item = file + the concrete problem + a suggested fix. Most severe first. If something is outright broken, say exactly what and where.`,
    { label: 'review', phase: 'Review & Verify', agentType: 'Explore' }),

  () => agent(`YOU ARE THE CI RUNNER. Working directory ${REPO}. Run these commands and report results VERBATIM (which passed/failed + the key error lines). Do NOT edit any files:
1) cd "${REPO}" && npm test
2) cd "${REPO}/voicethread-app" && node src/features/emotion/emotion.test.mjs
3) cd "${REPO}/voicethread-app" && npx --yes expo export -p android   (then remove the dist/ folder)
Summarize: PASS/FAIL for each, with exact errors for any failure.`,
    { label: 'verify', phase: 'Review & Verify', agentType: 'general-purpose' }),
]);

return { lanes: done, review, verify };
