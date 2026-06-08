// ============================================================================
//  Socket.IO relay tests — VoiceThread message relay.
// ----------------------------------------------------------------------------
//  Verifies the server's relay contract (server.js, io.on('connection')):
//    • join -> 'joined' to self (with members), 'peer_joined' to the peer
//    • message relays to the PEER only; sender gets NO echo but DOES get
//      a 'delivered' receipt {by:'server'}
//    • typing relays to the peer
//    • a 3rd joiner of a full (max 2) room gets error {code:'room_full'}
//    • disconnect emits 'peer_left' to the remaining member
//
//  Runs entirely against a locally spawned server (test port). No ElevenLabs.
// ============================================================================

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, TEST_PORT } from './helpers/server.js';
import { connectClient, once, expectNoEvent, closeAll } from './helpers/socket.js';

// Dedicated port for THIS file. Node runs test files in separate processes that
// may execute in parallel, so each file uses its own port to avoid binding the
// same one twice. (Base 3099 per the spec; http-validation uses +1.)
const PORT = TEST_PORT;

let server;
const connect = () => connectClient(server.baseUrl);

before(async () => { server = await startServer(PORT); });
after(async () => { await stopServer(server); });

// Unique room id per test so cases never collide (rooms are in-memory).
let roomSeq = 0;
let ROOM;
beforeEach(() => { ROOM = `test-room-${process.pid}-${roomSeq++}`; });

test('join: self receives "joined" with member list', async () => {
  const a = await connect();
  try {
    const joinedP = once(a, 'joined');
    a.emit('join', { roomId: ROOM, userId: 'alice', displayName: 'Alice' });
    const joined = await joinedP;

    assert.equal(joined.roomId, ROOM);
    assert.equal(joined.you, 'alice');
    assert.ok(Array.isArray(joined.members), 'members is an array');
    assert.equal(joined.members.length, 1);
    assert.equal(joined.members[0].userId, 'alice');
  } finally {
    closeAll(a);
  }
});

test('join: existing peer receives "peer_joined" when a second user joins', async () => {
  const a = await connect();
  const b = await connect();
  try {
    a.emit('join', { roomId: ROOM, userId: 'alice', displayName: 'Alice' });
    await once(a, 'joined');

    const peerJoinedP = once(a, 'peer_joined');
    b.emit('join', { roomId: ROOM, userId: 'bob', displayName: 'Bob' });
    const peer = await peerJoinedP;

    assert.equal(peer.userId, 'bob');
    assert.equal(peer.displayName, 'Bob');
  } finally {
    closeAll(a, b);
  }
});

test('join: missing roomId/userId -> error {code:"bad_room"}', async () => {
  const a = await connect();
  try {
    const errP = once(a, 'error');
    a.emit('join', { userId: 'alice' }); // no roomId
    const err = await errP;
    assert.equal(err.code, 'bad_room');
  } finally {
    closeAll(a);
  }
});

test('message: relays to the peer (peer receives identical payload)', async () => {
  const a = await connect();
  const b = await connect();
  try {
    a.emit('join', { roomId: ROOM, userId: 'alice' });
    await once(a, 'joined');
    b.emit('join', { roomId: ROOM, userId: 'bob' });
    await once(b, 'joined');

    const payload = { id: 'm1', text: 'hello', voiceId: 'v1' };
    const recvP = once(b, 'message');
    a.emit('message', payload);
    const received = await recvP;

    assert.deepEqual(received, payload, 'peer receives the exact payload');
  } finally {
    closeAll(a, b);
  }
});

test('message: sender gets NO echo of its own message', async () => {
  const a = await connect();
  const b = await connect();
  try {
    a.emit('join', { roomId: ROOM, userId: 'alice' });
    await once(a, 'joined');
    b.emit('join', { roomId: ROOM, userId: 'bob' });
    await once(b, 'joined');

    const noEchoP = expectNoEvent(a, 'message', 700);
    const peerGotItP = once(b, 'message');
    a.emit('message', { id: 'm2', text: 'no echo please' });

    await peerGotItP;   // confirm it actually went through to the peer
    await noEchoP;      // ...and confirm the sender never saw it
  } finally {
    closeAll(a, b);
  }
});

test('message: sender receives a "delivered" receipt {by:"server"}', async () => {
  const a = await connect();
  const b = await connect();
  try {
    a.emit('join', { roomId: ROOM, userId: 'alice' });
    await once(a, 'joined');
    b.emit('join', { roomId: ROOM, userId: 'bob' });
    await once(b, 'joined');

    const deliveredP = once(a, 'delivered');
    a.emit('message', { id: 'm3', text: 'receipt test' });
    const receipt = await deliveredP;

    assert.equal(receipt.messageId, 'm3');
    assert.equal(receipt.by, 'server');
  } finally {
    closeAll(a, b);
  }
});

test('typing: relays the indicator to the peer', async () => {
  const a = await connect();
  const b = await connect();
  try {
    a.emit('join', { roomId: ROOM, userId: 'alice' });
    await once(a, 'joined');
    b.emit('join', { roomId: ROOM, userId: 'bob' });
    await once(b, 'joined');

    const typingP = once(b, 'typing');
    a.emit('typing', { isTyping: true });
    const t = await typingP;

    assert.equal(t.userId, 'alice');
    assert.equal(t.isTyping, true);
  } finally {
    closeAll(a, b);
  }
});

test('room_full: a 3rd joiner of a full (max 2) room is rejected', async () => {
  const a = await connect();
  const b = await connect();
  const c = await connect();
  try {
    a.emit('join', { roomId: ROOM, userId: 'alice' });
    await once(a, 'joined');
    b.emit('join', { roomId: ROOM, userId: 'bob' });
    await once(b, 'joined');

    // The third client must NOT be admitted: expect an error, not 'joined'.
    const errP = once(c, 'error');
    const joinedShouldNotFire = expectNoEvent(c, 'joined', 800);
    c.emit('join', { roomId: ROOM, userId: 'carol' });

    const err = await errP;
    assert.equal(err.code, 'room_full');
    await joinedShouldNotFire;
  } finally {
    closeAll(a, b, c);
  }
});

test('peer_left: remaining member is notified when a peer disconnects', async () => {
  const a = await connect();
  const b = await connect();
  try {
    a.emit('join', { roomId: ROOM, userId: 'alice' });
    await once(a, 'joined');
    b.emit('join', { roomId: ROOM, userId: 'bob' });
    await once(b, 'joined');

    const peerLeftP = once(a, 'peer_left');
    b.close(); // hard disconnect -> server 'disconnect' -> cleanup()
    const left = await peerLeftP;

    assert.equal(left.userId, 'bob');
  } finally {
    closeAll(a, b);
  }
});

test('rate limit: a flood of messages from one socket gets rejected', async () => {
  const a = await connect();
  try {
    a.emit('join', { roomId: ROOM, userId: 'alice' });
    await once(a, 'joined');

    let rateLimited = 0;
    a.on('error', (e) => { if (e?.code === 'rate_limited') rateLimited++; });

    // Burst well past the limit (CONFIG.relay.msgRateLimit.points = 30 / 10s).
    for (let i = 0; i < 45; i++) a.emit('message', { id: `flood-${i}`, text: 'x' });

    await new Promise((r) => setTimeout(r, 800)); // let the server drain the burst
    assert.ok(rateLimited > 0, `expected some messages to be rate-limited, got ${rateLimited}`);
  } finally {
    closeAll(a);
  }
});
