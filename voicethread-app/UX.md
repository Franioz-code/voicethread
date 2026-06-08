# VoiceThread — UX / UI notes

VoiceThread is a **voice-first messenger**: you type (or, soon, speak) a short
message, the app detects the *emotion* on-device, and the other side hears it in
a natural ElevenLabs voice that carries that feeling. This document covers the
design rationale for the **milestone-1 screen** and the **eyes-free plan** for
the upcoming hands-free and driving modes.

Scope note: this is a PoC. The goal here is a screen that is clear, accessible,
and honest about its state — not a full design language. Everything visual lives
in `src/theme.js` so the next modes are a palette/size swap, not a rewrite.

---

## 1. Design system (`src/theme.js`)

A tiny, dependency-free token set — the single source of truth for the look.

| Token group     | What it holds                                   | Why it exists |
|-----------------|--------------------------------------------------|---------------|
| `colors`        | surfaces, text, brand, status                    | One palette to retheme (e.g. a high-contrast "driving" palette later). |
| `emotionColors` | per-emotion accent (joy/sadness/…)               | Color is a faster signal than text — the badge + intensity meter read at a glance. |
| `spacing`       | 4px scale (`xs`…`xxxl`)                           | Kills magic numbers; keeps rhythm consistent. |
| `radius`        | `sm`…`pill`                                       | Consistent rounding. |
| `type`          | title/heading/body/label/caption/footnote        | One typographic scale, biased slightly large for arm's-length reading. |
| `sizes`         | `tapMin` (44), `ctaHeight` (64), hit slop, etc.  | Encodes accessible tap-target rules so they can't drift. |

**Why dark-first.** A voice app is often used eyes-down, at night, or in a car.
Dark surfaces with high-contrast foreground reduce glare and battery use on OLED.
Foreground colors (`text`, `textDim`) are chosen to meet WCAG AA contrast against
the dark surfaces; status colors (success/danger) double as the only place we
rely on hue, and they are always paired with text + an icon/dot so the meaning
never depends on color alone (color-blind safe).

---

## 2. Milestone-1 screen — what changed and why

The screen keeps the exact same pipeline and contracts (backend auto-detect →
`GET /api/voices` → live on-device emotion → `GET /api/tts` → `expo-audio`
playback). The UX changes are layered on top:

### Clearer hierarchy
- **Header** = identity + connection status (icon dot + colored text), so "is it
  even connected?" is answerable in under a second.
- **Body** flows top-to-bottom in the order you actually work:
  *write → see the detected emotion → pick a voice → speak.*
- The detected emotion is promoted from an inline line to a **card with an
  intensity meter**, because the emotion is the whole point of the product — it
  deserves to be the visual centre of the screen.

### Larger, eyes-free tap targets
- Primary **"Mów"** button is a full-width, 64px-tall control — easy to hit
  without looking. Voice chips are ≥44px tall with generous `hitSlop`.
- Tap-target sizes come from `sizes` in the theme, so they stay honest as the UI
  grows.

### Contrast + accessibility
- Every interactive control has an `accessibilityRole` and `accessibilityLabel`,
  and where it helps, an `accessibilityHint` explaining what will happen.
- Voice chips expose `accessibilityRole="radio"` + `accessibilityState.selected`
  so a screen reader announces them as a single-choice group.
- The "Mów" button announces `disabled` / `busy` state and *why* it's disabled
  ("brak połączenia" vs "wpisz wiadomość").
- Errors render in an `accessibilityRole="alert"` live region so they are spoken
  the moment they appear.
- The decorative intensity meter is hidden from the screen reader (the same
  number is already announced on the card), avoiding double-speak.

### A visible loading / playing state on "Mów"
This was the biggest gap: previously the button fired and gave no feedback. Now
it is a small **state machine** driven by real playback status from
`expo-audio` (`player.addListener('playbackStatusUpdate', …)`):

| State     | Button shows                              | Behaviour on tap |
|-----------|-------------------------------------------|------------------|
| `idle`    | ▶︎ **Mów**                                | start synth + playback |
| `loading` | spinner + **Przygotowuję…**               | cancel (stop & reset) |
| `playing` | spinner + **Odtwarzam — dotknij, aby zatrzymać** | stop |

The listener also surfaces `status.error` into the error box and resets to
`idle` on `didJustFinish`, so the button never gets "stuck". A superseded player
(user tapped again quickly) is ignored via a ref check, preventing stale updates.

### Graceful empty + error states
- **No text** → "Mów" is disabled with a hint; the emotion card reads "Brak
  tekstu do analizy".
- **Voices not loaded yet** → a dashed placeholder ("Wczytuję dostępne głosy…").
- **Can't reach the backend** → a clear, actionable error (check the server,
  check the same Wi-Fi) plus the resolved `backend:` URL in the footer for
  debugging.

### Privacy framing (kept honest)
Per the project's hybrid-privacy stance: emotion is computed **on-device**; only
the text is sent transiently for synthesis; the relay stores nothing. We do **not**
claim zero-retention. The UI should never imply more privacy than we deliver — so
copy stays factual and avoids absolute promises.

---

## 3. Eyes-free plan (hands-free & driving modes)

The next milestones add **chat between two phones**, a **hands-free mode**, and a
**driving mode**. The guiding principle: *the user's eyes and hands belong to the
real world (a conversation, the road) — the app must be fully operable without
either.* Milestone-1 already lays the groundwork (state machine, large targets,
a11y labels, themeable tokens).

### 3.1 Shared principles
- **Audio-first feedback.** Every state change has a non-visual signal: a short
  earcon (start/stop/sent/received), haptics for confirmations, and TTS for
  content. Visuals become the *secondary* channel.
- **Glanceable, not readable.** When a screen is shown, it must be parseable in a
  ~1-second glance: one dominant element, big type, color-coded state. Reuse
  `emotionColors` so an incoming message's mood is visible before a word is read.
- **Forgiving input.** Large targets, big hit slop, generous debounce, and an
  always-available "cancel/stop". Destructive actions need confirmation
  (preferably spoken).
- **Predictable latency.** Always show/speak that something is happening
  (the loading state) — silence during a network call is the worst eyes-free
  failure. Pre-warm TTS where possible (the backend already caches by
  voice+model+settings+text).

### 3.2 Hands-free mode (phone on a table / in a pocket, conversational)
Goal: send and hear messages with **voice + minimal touch**.

- **Capture:** a single large push-to-talk target covering most of the screen, or
  a wake phrase. Record speech → STT (`POST /api/stt`, Scribe) → the same
  on-device emotion pass runs on the transcript → preview is **spoken back**
  ("Wyślę: …, brzmi na *uradowaną*") before sending. Confirm by voice or a tap.
- **Playback:** incoming messages auto-play (respecting a mute toggle), prefixed
  by a short earcon and the sender's name. The emotion rides in the voice itself,
  so no need to look.
- **Controls reduced to verbs:** *Mów / Wyślij / Powtórz / Dalej / Cisza.* Each is
  a big target and a voice command; each has an `accessibilityLabel` already-style
  contract.
- **Status by sound + one glance:** connection / recording / playing states use
  earcons + haptics; the screen mirrors them with the existing colored status
  pattern.

### 3.3 Driving mode (highest constraint — legally and physically eyes-off)
A stricter, opt-in skin of hands-free mode. **No reading, no precise taps.**

- **Layout:** a dedicated high-contrast theme (swap the `colors` palette + bump
  `type`/`sizes`) with **at most one giant button** and oversized text. No lists,
  no horizontal scrollers, no small chips.
- **Fully voice-driven loop:**
  1. New message arrives → earcon + auto-TTS ("Anna mówi, brzmi na *zmartwioną*: …").
  2. App prompts: "Odpowiedzieć?" → user speaks → STT → emotion → **spoken
     confirmation** → auto-send after a short countdown (cancelable by voice/tap).
- **Whole-screen tap = the only touch affordance** (push-to-talk / stop). It is
  impossible to hit the wrong control because there is effectively one control.
- **Safety defaults:** auto-play on, replies auto-confirm with a countdown,
  notifications are spoken not shown, and the mode is sticky until explicitly
  exited. Honor the OS (CarPlay / Android Auto, Do-Not-Disturb-While-Driving) and
  keep sessions short. Never require the user to read an error — speak it, and
  offer a one-word retry.

### 3.4 What milestone-1 already gives the next modes
- A **themeable** visual system → driving palette is a token swap.
- A **playback state machine** → reuse for auto-play, "Powtórz", and stop.
- **Accessibility labels/roles on every control** → screen-reader and
  voice-command layers build on the same metadata.
- **Honest, actionable status + error patterns** → become the spoken-status and
  spoken-error patterns for eyes-free use.
