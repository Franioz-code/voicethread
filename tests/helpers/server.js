// ============================================================================
//  Test helper — spawn / poll / reliably kill the VoiceThread backend.
// ----------------------------------------------------------------------------
//  Used by the automated suite (node:test). It boots server.js as a CHILD
//  process on a dedicated TEST port (3099 by default) so the tests never touch
//  a developer's running instance, then tears it down deterministically — on
//  Windows we use `taskkill /T /F` to also reap any grandchildren.
//
//  IMPORTANT (zero ElevenLabs credits): we inject a *dummy* ELEVENLABS_API_KEY
//  into the child's env. This makes server.js's ensureKey() gate PASS so that
//  the input-validation branches (missing field -> 400, over-long text -> 400)
//  actually run. Those 400s are returned BEFORE any network call to ElevenLabs,
//  so no real API request is ever made and no credits are spent. The dummy key
//  is never sent anywhere by these tests.
// ============================================================================

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_ENTRY = path.join(REPO_ROOT, 'server.js');

// Base test port. The spec calls for 3099; each test FILE adds a small offset
// (see startServer's `port` arg) so that Node's default per-file process
// isolation — which may run files in PARALLEL — never collides on one port.
export const TEST_PORT = Number(process.env.TEST_PORT) || 3099;
export const baseUrl = (port) => `http://localhost:${port}`;
// Convenience default for single-server callers.
export const BASE_URL = baseUrl(TEST_PORT);

const READY_TIMEOUT_MS = 20000; // generous: cold Node + Express + Socket.IO boot
const POLL_INTERVAL_MS = 150;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Spawn server.js on `port` and resolve once GET /api/config answers.
 * Returns the child decorated with `.baseUrl` for convenience.
 * @param {number} [port=TEST_PORT]
 * @returns {Promise<import('node:child_process').ChildProcess & { baseUrl: string }>}
 */
export async function startServer(port = TEST_PORT) {
  const BASE = baseUrl(port);
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      // Dummy key — only flips ensureKey() to true; never used for a real call
      // because every test either hits a validation 400 or a Socket.IO path.
      ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || 'test-dummy-key-not-used',
      // Keep the child quiet & deterministic.
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Detached on POSIX lets us signal the whole process group; on Windows we
    // rely on taskkill /T instead, so keep it false there.
    detached: process.platform !== 'win32',
  });

  // Surface child output only if a test fails / on debugging; capture so a
  // crash during boot produces a useful error message.
  let stderrBuf = '';
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', (d) => { stderrBuf += d.toString(); });

  let exited = false;
  let exitInfo = null;
  child.once('exit', (code, signal) => { exited = true; exitInfo = { code, signal }; });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(
        `Server exited during startup (code=${exitInfo?.code}, signal=${exitInfo?.signal}).\n` +
        `stderr:\n${stderrBuf || '(empty)'}`
      );
    }
    try {
      const res = await fetch(`${BASE}/api/config`);
      if (res.ok) {
        // Drain the body so the socket is freed.
        await res.json().catch(() => {});
        child.baseUrl = BASE;
        return child;
      }
    } catch {
      // Not listening yet — keep polling.
    }
    await sleep(POLL_INTERVAL_MS);
  }

  // Timed out — make a best-effort cleanup, then fail loudly.
  await stopServer(child).catch(() => {});
  throw new Error(
    `Server did not become ready on ${BASE} within ${READY_TIMEOUT_MS}ms.\n` +
    `stderr:\n${stderrBuf || '(empty)'}`
  );
}

/**
 * Reliably terminate the spawned server (and any children).
 * On Windows uses `taskkill /PID <pid> /T /F` (tree kill); elsewhere signals
 * the detached process group. Resolves once the child's 'exit' fires (or after
 * a short grace period) so test teardown is deterministic.
 * @param {import('node:child_process').ChildProcess} child
 */
export function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return resolve();
    }

    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };

    child.once('exit', done);

    if (process.platform === 'win32' && child.pid) {
      // /T = terminate child tree, /F = force. Spawn detached & ignore output;
      // we don't await it — the child's 'exit' event is our signal of success.
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.on('error', () => {
        // Fallback if taskkill is somehow unavailable.
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      });
    } else {
      try {
        // Negative pid => signal the whole process group (we spawned detached).
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    }

    // Safety net: never hang teardown.
    const grace = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      done();
    }, 5000);
    if (typeof grace.unref === 'function') grace.unref();
  });
}
