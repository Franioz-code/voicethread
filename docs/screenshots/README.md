# Screenshots

Drop **4 phone screenshots** here with these exact names — they're referenced by
the main `README.md`:

| File | What to capture |
|---|---|
| `conversations.png` | The **Rozmowy** home — the conversation list (a couple of chats, unread badge, the `Mów` / `🎙 Głos` / `＋ Nowa` header actions). |
| `chat.png` | An **open chat** showing the per-message **emotion chips** (emoji + label + intensity + `[tag]`), avatars, a ▶ play button and the 🎙 composer. |
| `voice-studio.png` | **Mój głos** — the voice-cloning studio (intro, the read-aloud script, the record / `Sklonuj` button). |
| `speak.png` | **Mów** — the speak-with-emotion screen with the live detected-emotion card; bonus if your `🎙 Twój głos` is selected. |

## How to add them

**On the phone (recommended — looks best for a CV):**
1. Open each screen in the app and take a screenshot (power + volume-down).
2. Transfer them to the laptop and rename to the names above.
3. Put them in this folder, then commit + push:
   ```bash
   git add docs/screenshots/*.png
   git commit -m "docs: app screenshots"
   git push
   ```

**Or via GitHub web:** open the repo → `docs/screenshots/` → **Add file → Upload files** → drag the 4 images (named as above) → commit.

> Tip: portrait shots ~1080×2340 look great scaled to the 210 px width used in the README.
