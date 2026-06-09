// VoiceThread — Socket.IO relay client (milestone 2).
// ----------------------------------------------------------------------------
// A thin wrapper around socket.io-client that mirrors the EXISTING relay
// contract in server.js. The server RELAYS and FORGETS: message content is
// never stored, so everything a peer needs to replay a message must travel
// inside the message payload itself.
//
// Wire contract (see server.js → io.on('connection')):
//   emit  join      { roomId, userId, displayName }
//   emit  message   <payload>            (relayed verbatim to the peer)
//   emit  typing    { isTyping }
//   emit  delivered { messageId }        (read/▶-style ack, peer-to-peer)
//   emit  played    { messageId }
//   emit  leave
//   recv  joined      { roomId, you, members }
//   recv  peer_joined { userId, displayName }
//   recv  peer_left   { userId }
//   recv  message     <payload>
//   recv  typing      { userId, isTyping }
//   recv  delivered   { messageId, by }
//   recv  played      { messageId, by }
//   recv  error       { code, message }
//
// Usage:
//   import * as relay from '../api/socket';
//   relay.connect();
//   relay.onPeer(({ type, ... }) => { ... });   // joined | peer_joined | peer_left | error
//   relay.onMessage((payload) => { ... });
//   relay.join('room-1234', { userId, displayName });
//   relay.sendMessage(payload);

import { io } from 'socket.io-client';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// --- Auto-detect the backend (same logic as App.js) -------------------------
// In Expo Go, Metro is served from the laptop's IP; server.js runs on the SAME
// laptop at port 3000, so we reuse that IP. Override with BACKEND_URL if needed.
function detectBackend() {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest2?.extra?.expoGo?.debuggerHost ||
    '';
  const host = hostUri.split(':')[0];
  return host ? `http://${host}:3000` : 'http://localhost:3000';
}

export const BACKEND_URL = detectBackend();

// --- Singleton socket -------------------------------------------------------
// One connection per app process. Listener sets let multiple hooks/screens
// subscribe without clobbering each other.
let socket = null;
const messageListeners = new Set(); // (payload) => void
const peerListeners = new Set();    // ({ type, ...data }) => void

function emitPeer(event) {
  peerListeners.forEach((cb) => {
    try { cb(event); } catch { /* a bad listener must not break the relay */ }
  });
}

/** Open the relay connection (idempotent). Returns the underlying socket. */
export function connect() {
  if (socket) return socket;

  // Web preview has no peer/relay — skip the persistent socket (keeps the page
  // idle so it renders + screenshots cleanly) and report "connected" so the UI
  // looks normal. Native devices use the real relay below.
  if (Platform.OS === 'web') {
    setTimeout(() => emitPeer({ type: 'connected' }), 0);
    return null;
  }

  socket = io(BACKEND_URL, {
    transports: ['websocket'], // RN has no XHR long-polling; go straight to WS
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    timeout: 8000,
  });

  // Connection lifecycle surfaced through the peer channel so the UI can react.
  socket.on('connect', () => emitPeer({ type: 'connected' }));
  socket.on('disconnect', (reason) => emitPeer({ type: 'disconnected', reason }));
  socket.on('connect_error', (err) =>
    emitPeer({ type: 'error', code: 'connect_error', message: err?.message || 'Brak połączenia z serwerem.' })
  );

  // Relay → peer-channel events.
  socket.on('joined', (data) => emitPeer({ type: 'joined', ...data }));
  socket.on('peer_joined', (data) => emitPeer({ type: 'peer_joined', ...data }));
  socket.on('peer_left', (data) => emitPeer({ type: 'peer_left', ...data }));
  socket.on('error', (data) => emitPeer({ type: 'error', ...data }));
  socket.on('delivered', (data) => emitPeer({ type: 'delivered', ...data }));
  socket.on('played', (data) => emitPeer({ type: 'played', ...data }));
  socket.on('typing', (data) => emitPeer({ type: 'typing', ...data }));

  // Incoming chat messages go to the dedicated message channel.
  socket.on('message', (payload) => {
    messageListeners.forEach((cb) => {
      try { cb(payload); } catch { /* isolate listener errors */ }
    });
  });

  return socket;
}

/** Join (or create) a 2-person room. `user` = { userId, displayName }. */
export function join(roomId, user = {}) {
  const s = connect();
  s.emit('join', {
    roomId,
    userId: user.userId,
    displayName: user.displayName,
  });
}

/** Relay a message payload verbatim to the peer. Must carry an `id`. */
export function sendMessage(payload) {
  if (!socket) return;
  socket.emit('message', payload);
}

/** Tell the peer we're typing (or stopped). */
export function typing(isTyping) {
  if (!socket) return;
  socket.emit('typing', { isTyping: !!isTyping });
}

/** Ack to the peer that we played their message (▶). */
export function played(messageId) {
  if (!socket) return;
  socket.emit('played', { messageId });
}

/** Ack to the peer that their message was delivered/seen. */
export function delivered(messageId) {
  if (!socket) return;
  socket.emit('delivered', { messageId });
}

/** Subscribe to incoming messages. Returns an unsubscribe function. */
export function onMessage(cb) {
  messageListeners.add(cb);
  return () => messageListeners.delete(cb);
}

/**
 * Subscribe to peer/lifecycle events. Returns an unsubscribe function.
 * Event shape: { type, ...data } where type is one of:
 *   connected | disconnected | joined | peer_joined | peer_left |
 *   typing | delivered | played | error
 */
export function onPeer(cb) {
  peerListeners.add(cb);
  return () => peerListeners.delete(cb);
}

/** Leave the current room but keep the socket open. */
export function leave() {
  if (socket) socket.emit('leave');
}

/** Tear down the connection and clear listeners. */
export function disconnect() {
  if (socket) {
    try { socket.emit('leave'); } catch { /* best effort */ }
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  messageListeners.clear();
  peerListeners.clear();
}

export default {
  BACKEND_URL,
  connect,
  join,
  sendMessage,
  typing,
  played,
  delivered,
  onMessage,
  onPeer,
  leave,
  disconnect,
};
