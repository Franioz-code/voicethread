// VoiceThread — useChat hook (milestone 2).
// ----------------------------------------------------------------------------
// Owns the message list + relay wiring for a 2-phone conversation and plays
// incoming messages with the on-device emotion pipeline.
//
// PRIVACY (hybrid model):
//   • Emotion is classified ON-DEVICE (src/features/emotion) at SEND time.
//   • The relay (server.js) stores NOTHING — so the emotion metadata + ttsText
//     travel INSIDE the message payload, and the receiver replays audio from
//     that metadata for an identical "accurate replay" every time.
//   • Only meta.ttsText is sent transiently to ElevenLabs (via GET /api/tts).
//
// Each message we render:
//   { id, mine, sender, text, ttsText, voiceId, modelId, voiceSettings,
//     ts, status }                          status: 'sent' | 'delivered'
//
// The per-contact voiceId tells us which voice to synthesize the PEER's
// messages in. We also stamp our OWN voiceId into outgoing payloads as a
// fallback, so a peer with no contact configured can still hear us.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { analyzeForSpeech } from '../emotion';
import * as relay from '../../api/socket';

const MODELS = { emotion: 'eleven_v3', fallback: 'eleven_multilingual_v2' };

// Build the GET /api/tts streaming URL the native player can play directly.
// Mirrors App.js: the player streams the URL, which is far more robust on RN
// than decoding binary audio in JS.
function ttsUrl(backend, { text, voiceId, modelId, voiceSettings }) {
  const vs = voiceSettings || {};
  const q =
    `text=${encodeURIComponent(text)}` +
    `&voiceId=${encodeURIComponent(voiceId)}` +
    `&modelId=${encodeURIComponent(modelId || MODELS.fallback)}` +
    (vs.stability != null ? `&stability=${vs.stability}` : '') +
    (vs.style != null ? `&style=${vs.style}` : '') +
    (vs.similarity_boost != null ? `&similarity_boost=${vs.similarity_boost}` : '') +
    (vs.use_speaker_boost != null ? `&use_speaker_boost=${vs.use_speaker_boost}` : '');
  return `${backend}/api/tts?${q}`;
}

const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// --- message-list reducer (avoids stale closures across relay callbacks) ----
function reducer(state, action) {
  switch (action.type) {
    case 'add':
      return [...state, action.message];
    case 'delivered':
      return state.map((m) =>
        m.id === action.id && m.mine ? { ...m, status: 'delivered' } : m
      );
    case 'reset':
      return [];
    default:
      return state;
  }
}

/**
 * @param {object}   opts
 * @param {string}   opts.roomId            pairing code shared by both phones
 * @param {string}   opts.userId            this device's stable id
 * @param {string}   opts.displayName       this device's name
 * @param {string}   opts.myVoiceId         voice to stamp on OUR outgoing messages
 * @param {string}   opts.contactVoiceId    voice to synthesize the PEER's messages in
 */
export function useChat({
  roomId,
  userId,
  displayName,
  myVoiceId,
  contactVoiceId,
} = {}) {
  const [messages, dispatch] = useReducer(reducer, []);
  const connRef = useRef('connecting'); // connecting | online | offline
  const peerRef = useRef(null);         // { userId, displayName } | null
  const typingRef = useRef(false);      // is the PEER currently typing
  const playerRef = useRef(null);
  const playingRef = useRef(null);      // id of the message currently playing
  const messagesRef = useRef(messages); // latest list for play(id) without deps
  const [, force] = useReducer((n) => n + 1, 0); // re-render on ref status flips

  // Keep refs in sync with the latest render so stable callbacks read fresh data.
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Keep the latest contact voice in a ref so the (stable) message handler
  // always reads the current value without re-subscribing.
  const contactVoiceRef = useRef(contactVoiceId);
  useEffect(() => { contactVoiceRef.current = contactVoiceId; }, [contactVoiceId]);

  // If the contact's voice changes mid-playback, stop the current clip so a
  // half-played message in the OLD voice doesn't linger (review fix).
  useEffect(() => {
    return () => {
      try { playerRef.current?.remove(); } catch { /* ignore */ }
      playerRef.current = null;
      playingRef.current = null;
    };
  }, [contactVoiceId]);

  const backend = relay.BACKEND_URL;

  // --- audio: play a message's text in the right voice ----------------------
  const playMessage = useCallback(
    (msg) => {
      if (!msg) return;
      // Peer messages use the per-contact voice; our own use our voice.
      // Fall back to the voiceId baked into the payload, then any known voice.
      const voiceId = msg.mine
        ? msg.voiceId || myVoiceId
        : contactVoiceRef.current || msg.voiceId || myVoiceId;
      if (!voiceId) return;

      try { playerRef.current?.remove(); } catch { /* ignore */ }
      try {
        const url = ttsUrl(backend, {
          text: msg.ttsText || msg.text,
          voiceId,
          modelId: msg.modelId,
          voiceSettings: msg.voiceSettings,
        });
        const player = createAudioPlayer(url);
        playerRef.current = player;
        playingRef.current = msg.id;
        force();
        player.play();
        // Tell the peer we listened to their message (for read/▶ receipts).
        if (!msg.mine) { try { relay.played(msg.id); } catch { /* ignore */ } }
      } catch {
        playingRef.current = null;
        force();
      }
    },
    [backend, myVoiceId]
  );

  // --- relay wiring (subscribe once per room) -------------------------------
  useEffect(() => {
    if (!roomId || !userId) return undefined;

    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    relay.connect();

    const offMsg = relay.onMessage((payload) => {
      if (!payload || !payload.id) return;
      dispatch({
        type: 'add',
        message: {
          id: payload.id,
          mine: false,
          sender: payload.sender || peerRef.current?.displayName || 'Rozmówca',
          text: payload.text || '',
          ttsText: payload.ttsText || payload.text || '',
          voiceId: payload.voiceId, // sender's own voice (fallback)
          modelId: payload.modelId,
          voiceSettings: payload.voiceSettings,
          ts: payload.ts || Date.now(),
          status: 'delivered',
        },
      });
      // Peer stopped "typing" once a message lands.
      typingRef.current = false;
      // Confirm delivery back to the sender.
      try { relay.delivered(payload.id); } catch { /* ignore */ }
    });

    const offPeer = relay.onPeer((ev) => {
      switch (ev.type) {
        case 'connected':
          connRef.current = 'online';
          // (Re)join the room on every (re)connect so reconnects rejoin.
          relay.join(roomId, { userId, displayName });
          force();
          break;
        case 'disconnected':
        case 'error':
          connRef.current = 'offline';
          force();
          break;
        case 'joined':
          connRef.current = 'online';
          peerRef.current =
            (ev.members || []).find((m) => m.userId !== userId) || peerRef.current;
          force();
          break;
        case 'peer_joined':
          peerRef.current = { userId: ev.userId, displayName: ev.displayName };
          force();
          break;
        case 'peer_left':
          peerRef.current = null;
          typingRef.current = false;
          force();
          break;
        case 'typing':
          if (ev.userId !== userId) { typingRef.current = !!ev.isTyping; force(); }
          break;
        case 'delivered':
          // Peer acked one of OUR messages.
          if (ev.messageId) dispatch({ type: 'delivered', id: ev.messageId });
          break;
        default:
          break;
      }
    });

    // If the socket is already connected (singleton reused), join now.
    relay.join(roomId, { userId, displayName });

    return () => {
      offMsg();
      offPeer();
      try { relay.leave(); } catch { /* ignore */ }
      try { playerRef.current?.remove(); } catch { /* ignore */ }
      playingRef.current = null;
    };
  }, [roomId, userId, displayName]);

  // --- actions --------------------------------------------------------------
  const send = useCallback(
    (raw) => {
      const text = (raw || '').trim();
      if (!text) return null;

      // On-device emotion → tags + model + voice settings + tagged ttsText.
      const meta = analyzeForSpeech(text, { models: MODELS });

      const payload = {
        id: uid(),
        sender: displayName,
        text,
        ttsText: meta.ttsText,
        voiceId: myVoiceId,        // so a peer w/o a contact configured can hear us
        modelId: meta.modelId,
        voiceSettings: meta.voiceSettings,
        emotion: meta.emotion,     // optional: lets the peer show an emoji
        intensity: meta.intensity,
        ts: Date.now(),
      };

      dispatch({
        type: 'add',
        message: { ...payload, mine: true, status: 'sent' },
      });
      try { relay.sendMessage(payload); } catch { /* offline: stays 'sent' */ }
      // Sending implies we stopped typing.
      try { relay.typing(false); } catch { /* ignore */ }
      return payload;
    },
    [displayName, myVoiceId]
  );

  const setTyping = useCallback((isTyping) => {
    try { relay.typing(isTyping); } catch { /* ignore */ }
  }, []);

  const play = useCallback((id) => {
    const msg = messagesRef.current.find((m) => m.id === id);
    playMessage(msg);
  }, [playMessage]);

  return {
    messages,
    peer: peerRef.current,
    peerTyping: typingRef.current,
    connection: connRef.current, // 'connecting' | 'online' | 'offline'
    playingId: playingRef.current,
    send,
    play,
    setTyping,
  };
}

export default useChat;
