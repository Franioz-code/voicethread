# VoiceThread — aplikacja mobilna (Expo)

Głosowy komunikator (iOS + Android). To jest **etap 1**: ekran „mów z emocją",
który sprawdza całą ścieżkę na jednym telefonie:
**wykrywanie emocji na urządzeniu → backend (ElevenLabs) → odtwarzanie głosu.**

Czat między dwoma telefonami, tryb bezdotykowy i tryb jazdy to kolejne etapy.

---

## Co jest potrzebne

- **Node.js** (już masz — używaliśmy go do backendu).
- **Telefon** (Android lub iPhone) i **ta sama sieć Wi‑Fi** co laptop.
- Aplikacja **Expo Go** na telefonie:
  - Android → Sklep Play: „Expo Go"
  - iPhone → App Store: „Expo Go"

---

## Uruchomienie (2 terminale na laptopie)

**Terminal 1 — backend** (w folderze `SMS`, tam gdzie `server.js` i `.env`):
```bash
npm start
```
Poczekaj na `✓ API key detected. Ready.`

**Terminal 2 — aplikacja** (w folderze `SMS/voicethread-app`):
```bash
npm install      # tylko za pierwszym razem (już zrobione)
npx expo start
```
Pojawi się **kod QR**.

**Na telefonie:**
- **Android:** otwórz **Expo Go** → „Scan QR code" → zeskanuj kod z terminala.
- **iPhone:** otwórz **Aparat**, najedź na kod QR, dotknij powiadomienia (otworzy Expo Go).

Po chwili zobaczysz apkę. U góry powinno być **„Połączono • N głosów"**.
Wpisz wiadomość → zobacz wykrytą emocję → wybierz głos → dotknij **„▶︎ Mów"**. 🔊

---

## Jak to działa (etap 1)

- Apka sama wykrywa adres backendu: bierze IP laptopa (ten sam, z którego działa
  Expo) i port `3000`. Adres widać na dole ekranu.
- Emocja liczona jest **na telefonie** (folder `src/features/emotion/`) — do
  backendu leci tylko gotowy tekst z tagami `eleven_v3`. Nic nie jest zapisywane.
- Dźwięk: apka odtwarza adres `GET /api/tts?...` przez `expo-audio` (bez kombinowania
  z danymi binarnymi).

Test modułu emocji (bez telefonu, za darmo):
```bash
npm run test:emotion
```

---

## Gdy coś nie działa

- **„Brak połączenia"**
  - Backend nie działa → uruchom `npm start` w folderze `SMS`.
  - Telefon i laptop w **różnych** sieciach → połącz oba z tym samym Wi‑Fi.
  - **Zapora Windows blokuje Node** (najczęstsza przyczyna) → przy pierwszym
    `npm start` Windows zapyta „Czy zezwolić Node.js…?" → kliknij **Zezwól**
    (dla sieci prywatnych). Jeśli nie zapytał, dodaj regułę dla portu 3000.
  - Używasz trybu **tunnel** w Expo → użyj domyślnego **LAN** (zwykłe
    `npx expo start`). W trybie tunnel auto‑wykrywanie wskazuje na tunel, nie na
    laptop. (Ostateczność: wpisz adres ręcznie w `App.js` → stała `BACKEND`.)
- **Brak dźwięku** → podgłośnij; sprawdź terminal backendu, czy nie ma błędu TTS.
- **„Klonowanie wymaga płatnego planu"** → to normalne na darmowym planie
  ElevenLabs; klonowanie głosu dodamy później.

---

## Struktura

```
voicethread-app/
├── App.js                         # ekran etapu 1 (mów z emocją)
├── src/features/emotion/          # moduł emocji on-device (czysty JS, testowalny)
│   ├── classifyEmotion.js
│   ├── emotionToSynthesis.js
│   ├── lexicons.js
│   ├── index.js
│   └── emotion.test.mjs
├── app.json  package.json  index.js  assets/
```

Pełny plan kolejnych etapów: `~/.claude/plans/dobra-teraz-musimy-to-whimsical-hamster.md`
