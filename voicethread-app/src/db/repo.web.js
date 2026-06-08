// VoiceThread — repo WEB fallback (in-memory).
// ============================================================================
// Metro resolves `.web.js` before `.js` on web, so the web preview uses THIS
// in-memory store instead of expo-sqlite (which targets native). Native devices
// keep using repo.js (real SQLite). Same API surface — drop-in.
//
// It is also SEEDED with a demo conversation (varied emotions) so the web
// preview shows a populated, realistic messenger for design iteration.

const now = Date.now();
const VOICES = { ola: 'EXAVITQu4vr4xnSDxMaL', me: 'pNInz6obpgDQGcFmaJgB' };

let conversations = [];
let messages = [];
let profile = { deviceUserId: 'u-web-demo', displayName: 'Franek', defaultVoiceId: VOICES.me, theme: 'light', drivingMode: false };
let seeded = false;

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

function seed() {
  if (seeded) return;
  seeded = true;
  conversations = [
    { id: 'c-ola', roomCode: 'demo-ola', ownerUserId: profile.deviceUserId, peerUserId: 'u-ola', peerDisplayName: 'Ola',
      contactName: 'Ola', contactVoiceId: VOICES.ola, myVoiceId: VOICES.me,
      createdAt: now - 2 * 864e5, lastMessageAt: now - 60_000, lastMessagePreview: 'Tylko pamiętaj o jutrzejszym terminie…', unreadCount: 2, archived: 0 },
    { id: 'c-mama', roomCode: 'demo-mama', ownerUserId: profile.deviceUserId, peerUserId: 'u-mama', peerDisplayName: 'Mama',
      contactName: 'Mama', contactVoiceId: VOICES.ola, myVoiceId: VOICES.me,
      createdAt: now - 5 * 864e5, lastMessageAt: now - 3 * 36e5, lastMessagePreview: 'Zadzwoń jak dojedziesz ❤️', unreadCount: 0, archived: 0 },
  ];
  const m = (over) => ({ conversationId: 'c-ola', sender: 'Ola', text: '', ttsText: '', voiceId: VOICES.ola, modelId: 'eleven_v3', voiceSettings: { stability: 0.4, style: 0.4 }, status: 'seen', played: 0, ...over });
  messages = [
    m({ id: 'm1', mine: false, text: 'Hej! Tęskniłam za Tobą 🥰', emotion: 'affection', intensity: 0.7, ts: now - 26 * 36e5 }),
    m({ id: 'm2', mine: true, sender: 'Franek', voiceId: VOICES.me, text: 'Hej! Ja też — ale mam super wieści 😄', emotion: 'joy', intensity: 0.6, ts: now - 26 * 36e5 + 60_000 }),
    m({ id: 'm3', mine: false, text: 'No mów, co się stało?!', emotion: 'surprise', intensity: 0.5, ts: now - 26 * 36e5 + 120_000 }),
    m({ id: 'm4', mine: true, sender: 'Franek', voiceId: VOICES.me, text: 'Dostałem tę pracę!!!', emotion: 'joy', intensity: 0.95, ts: now - 90 * 60_000 }),
    m({ id: 'm5', mine: false, text: 'Niee, gratulacje!!! 🎉 Tak się cieszę!', emotion: 'joy', intensity: 0.9, ts: now - 80 * 60_000 }),
    m({ id: 'm6', mine: false, text: 'Tylko pamiętaj o jutrzejszym terminie…', emotion: 'fear', intensity: 0.5, status: 'delivered', ts: now - 60_000 }),
  ];
}

export async function open() { seed(); return { web: true }; }
export const init = open;
export async function close() {}
export function __setDb() {}
export async function ensureDeviceId() { seed(); return profile.deviceUserId; }
export async function getProfile() { seed(); return clone(profile); }
export async function updateProfile(patch = {}) { profile = { ...profile, ...patch }; return clone(profile); }

export async function getConversations() {
  seed();
  return clone([...conversations].filter((c) => !c.archived)
    .sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt)));
}
export async function getConversation(id) { seed(); return clone(conversations.find((c) => c.id === id) || null); }
export async function getConversationByRoomCode(roomCode) { seed(); return clone(conversations.find((c) => c.roomCode === roomCode) || null); }
export async function findOrCreateConversation(userId, contactName, contactVoiceId, opts = {}) {
  seed();
  const roomCode = opts.roomCode || contactName;
  let c = conversations.find((x) => x.roomCode === roomCode);
  if (c) { c.contactName = contactName || c.contactName; c.contactVoiceId = contactVoiceId; if (opts.myVoiceId) c.myVoiceId = opts.myVoiceId; return clone(c); }
  c = { id: 'c-' + Math.random().toString(36).slice(2, 8), roomCode, ownerUserId: userId || profile.deviceUserId, peerUserId: opts.peerUserId || null, peerDisplayName: opts.peerDisplayName || null, contactName: contactName || roomCode, contactVoiceId, myVoiceId: opts.myVoiceId || contactVoiceId, createdAt: Date.now(), lastMessageAt: null, lastMessagePreview: null, unreadCount: 0, archived: 0 };
  conversations.push(c);
  return clone(c);
}
export async function updatePeerIdentity(id, { peerUserId, peerDisplayName } = {}) {
  const c = conversations.find((x) => x.id === id); if (!c) return;
  if (peerUserId) c.peerUserId = peerUserId; if (peerDisplayName) c.peerDisplayName = peerDisplayName;
}
export async function markConversationRead(roomId) {
  seed();
  const c = conversations.find((x) => x.roomCode === roomId); if (!c) return [];
  c.unreadCount = 0;
  const flipped = messages.filter((x) => x.conversationId === c.id && !x.mine && x.status === 'delivered');
  flipped.forEach((x) => { x.status = 'seen'; });
  return flipped.map((x) => x.id);
}
export async function deleteConversation(id) { conversations = conversations.filter((c) => c.id !== id); messages = messages.filter((m) => m.conversationId !== id); }

export async function getMessages(roomId) {
  seed();
  const c = conversations.find((x) => x.roomCode === roomId); if (!c) return [];
  return clone(messages.filter((m) => m.conversationId === c.id).sort((a, b) => a.ts - b.ts));
}
export async function getMessageById(id) { return clone(messages.find((m) => m.id === id) || null); }
export async function addMessage(message = {}, opts = {}) {
  seed();
  let convId = message.conversationId;
  if (!convId && message.roomId) convId = (conversations.find((c) => c.roomCode === message.roomId) || {}).id;
  if (!convId) return { inserted: false, message: null };
  if (messages.some((m) => m.id === message.id)) return { inserted: false, message: clone(messages.find((m) => m.id === message.id)) };
  const row = { id: message.id, conversationId: convId, mine: !!message.mine, sender: message.sender ?? null, text: message.text ?? '', ttsText: message.ttsText ?? null, voiceId: message.voiceId ?? null, modelId: message.modelId ?? null, voiceSettings: message.voiceSettings ?? null, emotion: message.emotion ?? null, intensity: message.intensity ?? null, ts: message.ts ?? Date.now(), status: message.status || (message.mine ? 'sent' : (opts.isOpen ? 'seen' : 'delivered')), played: message.played ? 1 : 0 };
  messages.push(row);
  const c = conversations.find((x) => x.id === convId);
  if (c) { c.lastMessageAt = row.ts; c.lastMessagePreview = row.text.slice(0, 140); if (!row.mine && !opts.isOpen) c.unreadCount += 1; }
  return { inserted: true, message: clone(row) };
}
export async function updateMessageStatus(id, status) { const m = messages.find((x) => x.id === id); if (m) m.status = status; return !!m; }
export async function markPlayed(id) { const m = messages.find((x) => x.id === id); if (m) m.played = 1; }
export async function getTotalUnread() { seed(); return conversations.reduce((s, c) => s + (c.unreadCount || 0), 0); }

export default {
  init, open, close, __setDb, ensureDeviceId, getProfile, updateProfile,
  getConversations, getConversation, getConversationByRoomCode, findOrCreateConversation,
  updatePeerIdentity, markConversationRead, deleteConversation,
  getMessages, getMessageById, addMessage, updateMessageStatus, markPlayed, getTotalUnread,
};
