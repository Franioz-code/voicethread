// ============================================================================
//  Test helper — Socket.IO client utilities.
// ----------------------------------------------------------------------------
//  Thin wrappers around socket.io-client (already a devDependency) used by the
//  relay tests. All clients use transports:['websocket'] so the handshake is a
//  single upgrade (faster + deterministic; no long-poll fallback flakiness).
// ============================================================================

import { io } from 'socket.io-client';

/**
 * Create a connected Socket.IO client and resolve once 'connect' fires.
 * @param {string} baseUrl  e.g. server.baseUrl returned by startServer()
 * @returns {Promise<import('socket.io-client').Socket>}
 */
export function connectClient(baseUrl) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      timeout: 5000,
    });
    const onErr = (err) => {
      socket.close();
      reject(new Error('connect_error: ' + (err?.message || err)));
    };
    socket.once('connect_error', onErr);
    socket.once('connect', () => {
      socket.off('connect_error', onErr);
      resolve(socket);
    });
  });
}

/**
 * Resolve with the first payload emitted on `event`, or reject after `timeoutMs`.
 * @template T
 * @param {import('socket.io-client').Socket} socket
 * @param {string} event
 * @param {number} [timeoutMs]
 * @returns {Promise<T>}
 */
export function once(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out (${timeoutMs}ms) waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

/**
 * Assert that `event` does NOT fire within `windowMs`. Resolves true if silent,
 * rejects if the event is received. Used to prove the sender gets no echo.
 * @param {import('socket.io-client').Socket} socket
 * @param {string} event
 * @param {number} [windowMs]
 */
export function expectNoEvent(socket, event, windowMs = 600) {
  return new Promise((resolve, reject) => {
    const handler = (payload) => {
      clearTimeout(timer);
      socket.off(event, handler);
      reject(new Error(`Unexpected "${event}" received: ${JSON.stringify(payload)}`));
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(true);
    }, windowMs);
    socket.on(event, handler);
  });
}

/** Close a list of sockets, ignoring nulls/errors. */
export function closeAll(...sockets) {
  for (const s of sockets) {
    try { s?.removeAllListeners?.(); s?.close?.(); } catch { /* ignore */ }
  }
}
