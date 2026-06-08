# VoiceThread — messenger feature backlog ("everything a typical messenger has")

Scope for a **1:1 voice-first messenger** PoC. Built AFTER the ElevenLabs redesign,
on the restyled files, by the features team. Must respect our pillars:
**privacy** (relay stores nothing; history lives on-device), **voice-first**, and
**Expo Go compatibility** (SDK 54) for the items in Tier 1–2.

## Tier 1 — Essentials (commit; the backbone of "a real messenger")
| Feature | How | Where |
|---|---|---|
| **Conversation list** | A home list of chats (contact, last message, time, unread badge); tap to open; "+ New chat" (pairing code + name + voices). Replaces the single setup screen as the default. | new `src/features/chat/ConversationsScreen.js`; `App.js` routing |
| **Local message history (persistent)** | Store messages + conversations on-device so history survives restarts (privacy: never on the server). | `expo-sqlite`; `src/db/` (schema + repo); `useChat` reads/writes |
| **Timestamps + date separators** | Per-message time; "Today/Yesterday/date" separators in the thread. | `ChatScreen.js` |
| **Delivered + Seen receipts** | Extend relay `delivered`; add `seen`/read; single/double/▶-tick UI. | relay events (`server.js`), `useChat`, `ChatScreen` |
| **Typing + presence** | Already have typing + peer presence; add "online / last seen". | `useChat`, `ChatScreen` header |
| **Avatars** | Monochrome initials avatar per contact (brand-styled). | `src/ui/Avatar.js` |
| **Unread counts** | Track unread per conversation; badge in the list; clear on open. | `src/db/`, list |
| **Settings / profile** | Your display name, your voice, theme (light/dark), privacy disclosure, driving-mode defaults. | new `src/features/settings/SettingsScreen.js` |

## Tier 2 — Standard interactions (commit)
| Feature | How |
|---|---|
| **Message actions** | Long-press → reply/quote, copy, delete (local), "play" (TTS). |
| **Reactions** | Emoji reactions on a message (relay `reaction` event + local). |
| **Voice messages** 🎤 | Record audio (expo-audio) → send. Privacy-friendly default: transcribe with Scribe and send **text + the on-device emotion** (so the peer hears it in your voice via TTS — our signature). Optionally also attach the recorded clip (base64 over the relay, ephemeral, not stored server-side). |
| **In-conversation search** | Search messages locally (SQLite). |
| **Pull-to-refresh / load older** | Paginate history from SQLite. |
| **Empty / loading / error states** | Polished, on-brand. |

## Tier 3 — Heavy / architectural (OPT-IN — needs bigger changes or breaks Expo Go)
These genuinely change the architecture or the run model. **Flag to confirm before building:**
| Feature | Cost / caveat |
|---|---|
| **Group chats** | Relay is capped at 2/room → needs multi-member rooms + fan-out + sender labels in `server.js`. |
| **Image / file attachments** | Needs media transfer (relay base64 or a blob endpoint) + on-device caching; privacy review (what touches the server). |
| **Push notifications** | Requires `expo-notifications` + **a dev build (EAS)** — does **not** work in Expo Go. Would move testing off Expo Go. |
| **Audio / video calls** | Large (WebRTC); out of PoC scope. |

## Notes
- History/search/settings are **on-device** → consistent with "relay stores nothing".
- Voice messages lean into the product's identity (your real voice) and reuse the emotion+TTS pipeline.
- Implementation order: SQLite + conversation list first (foundation), then receipts/timestamps/avatars/settings, then Tier 2 interactions.
