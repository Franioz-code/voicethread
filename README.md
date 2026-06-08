# VoiceThread 🗣️💬

Turn an SMS-style message thread into a **natural spoken conversation** using the
[ElevenLabs](https://elevenlabs.io) API — with a **different voice for each person**.

Built for one situation: two people staying in touch when one of them can't talk
or type (for example, while **driving**). Incoming texts are read aloud in a
natural human voice, and you can reply by **speaking**.

- **Backend:** Node.js + Express. Holds the ElevenLabs API key and proxies *all*
  ElevenLabs calls — the key is **never** exposed to the browser.
- **Frontend:** one static page, vanilla HTML/CSS/JS (no framework). Native
  `<audio>` for playback, `MediaRecorder` for the mic.

---

## What it does

- 📱 Shows a hardcoded Polish thread between **Ola** and **Franek** as iMessage-style bubbles.
- ▶️ **Odtwórz rozmowę** ("Play conversation") reads the whole thread in order,
  using a distinct ElevenLabs voice per person, via the multilingual model so Polish sounds natural.
- ▶︎ A small play button on **each** message.
- 🎤 **Odpowiedz głosem** ("Reply by voice") — record a Polish reply, it's transcribed
  by ElevenLabs Scribe, added to the thread as your message, and read back automatically.
- 🚗 **Tryb jazdy** ("Driving mode") — big buttons, simplified layout, and new
  incoming messages are read aloud automatically. Eyes-free.

---

## Setup & run

### 1. Get a free ElevenLabs API key

1. Go to **https://elevenlabs.io** and create a free account (the free tier is
   enough to try this out).
2. Click your name in the **bottom-left** corner → **API Keys** → **Create API Key**.
3. Copy the key (it looks like `sk_...`).

### 2. Set the key

Either create a `.env` file (easiest), or set a real environment variable.

**Option A — `.env` file (recommended):**

```bash
# copy the template, then edit it
cp .env.example .env
```

Open `.env` and paste your key:

```
ELEVENLABS_API_KEY=sk_your_real_key_here
```

**Option B — environment variable:**

- **Windows (PowerShell):**
  ```powershell
  $env:ELEVENLABS_API_KEY = "sk_your_real_key_here"
  ```
  (This lasts for the current PowerShell window. To run the app, set it, then `npm start` in the same window.)

- **macOS / Linux (bash/zsh):**
  ```bash
  export ELEVENLABS_API_KEY="sk_your_real_key_here"
  ```

### 3. (Optional) Set the two voices

Open **`server.js`** and find the big **`CONFIG`** block near the top. Paste the
two voice IDs you want there:

```js
participants: [
  { name: 'Ola',    self: false, voiceId: 'EXAVITQu4vr4xnSDxMaL' }, // Sarah — female
  { name: 'Franek', self: true,  voiceId: 'pNInz6obpgDQGcFmaJgB' }, // Adam  — male
],
```

It already ships with two working premade voices (**Sarah** + **Adam**), so you
can skip this step the first time. To use your own:

- Start the server, then open **http://localhost:3000/api/voices** — it lists
  every voice your account can use via the API, with names and IDs. Copy two and
  paste them above.
- Or go to **https://elevenlabs.io/app/voices**, open a voice, click the **`...`**
  menu → **Copy Voice ID**.

> ⚠️ **Free tier + voices:** on the free plan the API can only use ElevenLabs
> **premade / default** voices. Voices from the **Voice Library** return
> `HTTP 402` ("Free users cannot use library voices via the API"). Stick to the
> IDs shown by `/api/voices`. (Default voices are also scheduled to expire
> **2026-12-31** — swap in a current one if an ID ever stops working.)

### 4. Install and start

```bash
npm install
npm start
```

### 5. Open the app

> **http://localhost:3000**

Click **▶︎ Odtwórz rozmowę** and you should hear two distinct voices read the
Polish conversation. 🎉

---

## How to use

| Button | What it does |
| --- | --- |
| **▶︎ Odtwórz rozmowę** | Reads the entire thread in order (switching voices). Click again to stop. |
| ▶︎ (on a bubble) | Reads just that one message. |
| **🎤 Odpowiedz głosem** | Click to start recording, click again to stop & send. Your speech is transcribed (Polish), added as your message, and read back. |
| **🚗 Tryb jazdy** | Driving mode: large buttons + new incoming messages auto-read. |
| **＋ Wiadomość od Oli** | Adds a sample incoming message (in driving mode it's read aloud automatically — handy for demoing eyes-free use). |

---

## Configuration reference (top of `server.js`)

| Key | Meaning | Default |
| --- | --- | --- |
| `participants[].voiceId` | ElevenLabs voice ID per person | Sarah / Adam |
| `ttsModelId` | TTS model (multilingual for Polish) | `eleven_multilingual_v2` |
| `sttModelId` | Scribe speech-to-text model | `scribe_v1` |
| `sttLanguage` | Transcription language (ISO-639-1) | `pl` |
| `ttsOutputFormat` | mp3 quality | `mp3_44100_128` |
| `port` | Server port (or `PORT` env var) | `3000` |

---

## How the ElevenLabs integration works

All ElevenLabs traffic goes through the server (`server.js`) so the key stays secret.
The two calls are clearly commented in the code:

- **Text-to-Speech** — `POST /api/tts { text, voiceId }` → calls
  `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` and returns mp3.
  Responses are **cached by `text + voiceId`** (in memory and in a local
  `.cache/` folder) so repeats don't re-call the API.
- **Speech-to-Text** — `POST /api/stt` (raw audio) → forwards the audio to
  `POST https://api.elevenlabs.io/v1/speech-to-text` (Scribe) and returns `{ text }`.

If the key is missing or a call fails, a clear error is shown in the UI.

---

## Project structure

```
SMS/
├── server.js          # Express server + ElevenLabs proxy + CONFIG block
├── public/
│   └── index.html     # the entire frontend (HTML + CSS + JS)
├── package.json
├── .env.example       # template for your API key
├── .gitignore
└── README.md
```

---

## Troubleshooting

- **"Brak klucza ELEVENLABS_API_KEY"** — the server started without a key. Set it
  (step 2) and restart `npm start`.
- **401 / unauthorized from ElevenLabs** — the key is wrong or was revoked. Create a new one.
- **`402 Free users cannot use library voices via the API`** — you're using a
  Voice Library voice on the free tier. Open **http://localhost:3000/api/voices**,
  pick two **premade** IDs, paste them into the `CONFIG` block in `server.js`, and
  restart. (The shipped defaults are already premade.)
- **A voice ID error** — the voice ID isn't on your account (or a preset expired).
  Swap in a valid ID from `/api/voices` or https://elevenlabs.io/app/voices.
- **Microphone doesn't work** — allow mic access when the browser asks. `localhost`
  is treated as a secure origin, so recording works there without HTTPS.
- **No sound** — some browsers block autoplay until you interact with the page;
  clicking a button first (which you do) satisfies this.

---

## Notes / constraints (v1 demo)

The bundled web page (`public/index.html`) is the original minimal demo: one
Express server + one HTML file, no database, hardcoded sample thread. It still
works as described above.

---

# Backend 2.0 — voice messenger (in progress)

The project is evolving into a standalone **voice-first messenger** (separate
React Native / Expo app in `voicethread-app/`). The full design is in the plan
file: `~/.claude/plans/dobra-teraz-musimy-to-whimsical-hamster.md`.

The same `server.js` now also acts as the messenger backend. **It relays
messages between two devices and never stores them.**

### HTTP API

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/tts` | `{ text, voiceId, modelId?, voiceSettings?, outputFormat? }` | mp3 (cached by voice+model+settings+text) |
| `POST /api/stt` | raw audio bytes | `{ text }` (ElevenLabs Scribe) |
| `GET /api/voices` | — | `{ premade: [{voice_id, name, gender}] }` |
| `POST /api/voices/add?name=...` | raw audio sample (1–2 min) | `{ voiceId }` — **needs a PAID ElevenLabs plan** (clear 402 otherwise) |
| `GET /api/config` | — | models, cache mode, `hasApiKey` |

`POST /api/tts` accepts `eleven_v3` emotion tags inside `text` (e.g.
`"[happy] Cześć!"`); they're passed through untouched.

### Socket.IO relay events

Pairing: one device picks a short room code, the other joins it (max 2 per room).

- **client → server:** `join {roomId,userId,displayName}`, `message {payload}`, `typing {isTyping}`, `delivered {messageId}`, `played {messageId}`, `leave`
- **server → client:** `joined`, `peer_joined`, `peer_left`, `message`, `typing`, `delivered`, `played`, `error {code}`

Message payload: `{ id, roomId, from, text? | (ciphertext?+nonce?), ts, emotion?, v:1 }`
(the `text`/`ciphertext` seam lets E2E encryption drop in later without changing the relay).

### On-device emotion module (`voicethread-app/src/features/emotion/`)

Pure, offline, multilingual emotion detection → ElevenLabs `eleven_v3` audio
tags + voice settings, so messages are read with the right feeling and **sound
the same on every replay** (the result is stored as message metadata). Handles
mixed-language text (e.g. Polish with "goat"/"haha"). Run its test:

```bash
node voicethread-app/src/features/emotion/emotion.test.mjs
```

### Privacy

The relay forwards messages in memory and does **not** store them. The mp3 cache
mode is configurable in `CONFIG.cache` (`memory` = nothing on disk, the default).
We do **not** claim zero-retention at ElevenLabs (that's Enterprise-only); text
is sent there transiently only to synthesize or transcribe, and this is
disclosed to the user. See the plan file for the full privacy model.

### Config

New `CONFIG` keys in `server.js`: `ttsModels` (emotion/latency/fallback),
`defaultVoiceSettings`, `cache` + `cacheTtlMs`, `relay` (room size + rate limit),
`corsOrigin`.
