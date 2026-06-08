// ============================================================================
//  HTTP validation tests — /api/tts and /api/voices/add.
// ----------------------------------------------------------------------------
//  These tests assert the request-validation contract WITHOUT ever calling
//  ElevenLabs, so the suite spends ZERO credits and needs no real API key.
//
//  Why no real ElevenLabs call happens (see server.js):
//    • The spawned server has a *dummy* ELEVENLABS_API_KEY, so ensureKey()
//      passes and the validation branches execute.
//    • Every assertion below targets an input that triggers a 400 which is
//      returned BEFORE any `fetch()` to ElevenLabs:
//        - POST /api/tts          : missing text/voiceId, or text > 5000 chars
//        - POST /api/voices/add   : missing audio body
//      None of these reach synthesize()/the cloning fetch.
//
//  Plus a /api/config smoke test (also the server-readiness probe).
// ============================================================================

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, TEST_PORT } from './helpers/server.js';

// Dedicated port for THIS file (+1) so it never collides with relay.test.js
// when Node runs the two files in parallel worker processes.
const PORT = TEST_PORT + 1;

let server;
const url = (path) => `${server.baseUrl}${path}`;

before(async () => { server = await startServer(PORT); });
after(async () => { await stopServer(server); });

const postJson = (path, body) =>
  fetch(url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// --- /api/config -----------------------------------------------------------

test('GET /api/config returns expected shape', async () => {
  const res = await fetch(url('/api/config'));
  assert.equal(res.status, 200);
  const cfg = await res.json();

  assert.ok(Array.isArray(cfg.participants), 'participants is an array');
  assert.ok(cfg.ttsModels && typeof cfg.ttsModels === 'object', 'ttsModels present');
  assert.equal(typeof cfg.ttsModelId, 'string'); // back-compat field for web demo
  assert.equal(typeof cfg.sttModelId, 'string');
  assert.equal(typeof cfg.hasApiKey, 'boolean');
});

// --- POST /api/tts validation ---------------------------------------------

test('POST /api/tts: missing both fields -> 400', async () => {
  const res = await postJson('/api/tts', {});
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error, 'error message present');
});

test('POST /api/tts: missing voiceId -> 400', async () => {
  const res = await postJson('/api/tts', { text: 'Cześć' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});

test('POST /api/tts: missing text -> 400', async () => {
  const res = await postJson('/api/tts', { voiceId: 'EXAVITQu4vr4xnSDxMaL' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});

test('POST /api/tts: over-long text (>5000 chars) -> 400', async () => {
  const res = await postJson('/api/tts', {
    text: 'a'.repeat(5001),
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(/5000/.test(body.error), 'mentions the 5000-char limit');
});

// --- POST /api/voices/add validation --------------------------------------

test('POST /api/voices/add: missing audio body -> 400', async () => {
  // Send a non-empty content-type but an empty body. server.js reads the raw
  // body and rejects when it is empty — BEFORE any ElevenLabs cloning call.
  const res = await fetch(url('/api/voices/add?name=Test'), {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    // no body
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error, 'error message present');
});

test('POST /api/voices/add: empty buffer body -> 400 (no ElevenLabs call)', async () => {
  const res = await fetch(url('/api/voices/add'), {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    body: new Uint8Array(0),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});
