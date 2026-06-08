// VoiceThread — App home.
// ----------------------------------------------------------------------------
// The home is now the CONVERSATIONS LIST (milestone 2): an on-device, newest-
// first list of chats (contact name, last-message preview, time, unread badge)
// backed by the SQLite data layer (src/db/repo). From there you can:
//
//   • "+ Nowa rozmowa" → the pairing-code + voice-picker setup (ChatSetupScreen).
//     Connecting create-or-resumes a conversation row (idempotent on the room
//     code) and opens the iMessage-style chat (ChatScreen).
//   • Tap a conversation → opens its ChatScreen using the STORED room code +
//     voices, so reopening a chat replays its persisted history.
//   • "Mów" (header action) → the milestone-1 "speak with emotion" playground
//     (unchanged): on-device emotion detection → backend (ElevenLabs) TTS →
//     playback. Still fully reachable, just no longer the landing surface.
//
// IDENTITY: the relay userId + display name come from the persisted device
// profile (repo.getProfile()/ensureDeviceId()) instead of a random per-session
// id, so the same phone keeps a stable identity across launches.
//
// DATA LAYER: repo.open() runs ONCE at app start (gated splash) to create/migrate
// the local DB before any screen reads it. Nothing here talks to a server for
// durable state — the relay stays content-less; all history lives on-device.
//
// VISUAL LANGUAGE — ElevenLabs (see docs/ELEVENLABS-BRAND.md): monochrome warm-
// stone canvas, ink pill CTAs, hairline borders, generous spacing on a 4px grid,
// Inter type, and a soft pastel GradientOrb as atmosphere behind the wordmark.
// All behaviour, network contracts and accessibility are preserved verbatim.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { analyzeForSpeech } from './src/features/emotion';
import ChatScreen from './src/features/chat/ChatScreen';
import ConversationsScreen from './src/features/chat/ConversationsScreen';
import * as repo from './src/db/repo';
import {
  colors,
  emotionColors,
  gradientOrbs,
  radius,
  sizes,
  spacing,
  type,
  useFont,
} from './src/theme';
import { GradientOrb, Wordmark } from './src/ui';

// --- Auto-detect the backend ------------------------------------------------
// In Expo Go, Metro is served from your laptop's IP. The backend (server.js)
// runs on the SAME laptop at port 3000, so we reuse that IP automatically.
// If detection fails, set BACKEND manually to http://<your-laptop-IP>:3000
const hostUri =
  Constants.expoConfig?.hostUri ||
  Constants.expoGoConfig?.debuggerHost ||
  Constants.manifest2?.extra?.expoGo?.debuggerHost ||
  '';
const HOST = hostUri.split(':')[0];
const BACKEND = HOST ? `http://${HOST}:3000` : 'http://localhost:3000';

const MODELS = { emotion: 'eleven_v3', fallback: 'eleven_multilingual_v2' };
const EMOJI = { joy: '😊', sadness: '😔', anger: '😠', fear: '😨', affection: '❤️', surprise: '😮', neutral: '😐' };
const PL = { joy: 'radość', sadness: 'smutek', anger: 'złość', fear: 'strach', affection: 'czułość', surprise: 'zaskoczenie', neutral: 'neutralny' };

// Playback lifecycle for the "Mów" button, so the UI can show a clear,
// eyes-free state instead of a button that silently "did something".
const PLAY = { idle: 'idle', loading: 'loading', playing: 'playing' };

// Top-level views. The conversation list is the landing surface; the others are
// full-screen and bring (or get) their own header.
const VIEW = { list: 'list', newChat: 'newChat', chat: 'chat', speak: 'speak' };

// ===========================================================================
// App — shell: opens the DB, loads the device profile + voices, and routes
// between the conversation list, the new-chat setup, a live chat, and "Mów".
// ===========================================================================
export default function App() {
  // Load Inter for the brand type scale. Degrades to system font (returns true)
  // if the packages are unavailable, so first paint is never blocked.
  const fontsReady = useFont();

  const [dbReady, setDbReady] = useState(false);
  const [profile, setProfile] = useState(null); // { deviceUserId, displayName, ... }

  const [view, setView] = useState(VIEW.list);
  const [status, setStatus] = useState('Łączę z serwerem…');
  const [voices, setVoices] = useState([]);
  const [error, setError] = useState('');

  // The active conversation (props ChatScreen consumes). null until one opens.
  const [chatSession, setChatSession] = useState(null);
  // On-device conversation list (repo.rowToConversation shapes), newest-first.
  const [conversations, setConversations] = useState([]);

  // --- open + migrate the local DB ONCE, then load the device profile -------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await repo.open(); // create/migrate tables + ensure the device id
        const p = await repo.getProfile();
        if (!cancelled) setProfile(p);
      } catch {
        // Even if the profile read fails, let the app render — screens that need
        // the DB will retry through repo's lazy open().
      } finally {
        if (!cancelled) setDbReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ONE voices fetch shared by every mode (Speak preselects the first voice;
  // the setup form lets you pick MY + CONTACT voice from the same list).
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    fetch(`${BACKEND}/api/voices`)
      .then((r) => r.json())
      .then((d) => {
        const list = d.premade || [];
        setVoices(list);
        setStatus(`Połączono • ${list.length} ${plural(list.length, 'głos', 'głosy', 'głosów')}`);
      })
      .catch(() => {
        setStatus('Brak połączenia');
        setError(`Nie mogę połączyć się z ${BACKEND}.\nSprawdź, czy serwer działa (npm start) i czy telefon jest w tej samej sieci Wi‑Fi.`);
      });
  }, []);

  const connected = voices.length > 0;

  // Refresh the conversation list from the DB. Called on first ready and every
  // time we return to the list (so previews/unread/time reflect new messages).
  const refreshConversations = useCallback(async () => {
    if (!dbReady) return;
    try {
      const list = await repo.getConversations(profile?.deviceUserId);
      setConversations(list);
    } catch {
      setConversations([]);
    }
  }, [dbReady, profile?.deviceUserId]);

  // Re-pull the list whenever we land on it (return-to-list refresh).
  useEffect(() => {
    if (view === VIEW.list) refreshConversations();
  }, [view, refreshConversations]);

  // --- new-chat flow: create-or-resume the conversation, then open it -------
  // Faithful to the data-layer contract: findOrCreateConversation is idempotent
  // on the room code, so re-pairing the same code resumes the existing thread.
  const handleConnect = useCallback(
    async (form) => {
      const userId = profile?.deviceUserId;
      const displayName = form.displayName || profile?.displayName || 'Ja';
      // Persist the typed name as our profile display name (first time / changes),
      // so it's the stable identity for future chats. Best-effort.
      if (form.displayName && form.displayName !== profile?.displayName) {
        repo.updateProfile({ displayName: form.displayName }).catch(() => {});
      }
      try {
        const convo = await repo.findOrCreateConversation(
          userId,
          form.contactName,
          form.contactVoiceId,
          { roomCode: form.roomId, myVoiceId: form.myVoiceId }
        );
        openConversation({
          roomId: convo.roomCode,
          contactName: convo.contactName,
          contactVoiceId: convo.contactVoiceId,
          myVoiceId: convo.myVoiceId,
        }, { userId, displayName });
      } catch {
        // If persistence somehow fails, still open the chat with the form values
        // so the relay experience is never blocked by the local store.
        openConversation(
          {
            roomId: form.roomId,
            contactName: form.contactName,
            contactVoiceId: form.contactVoiceId,
            myVoiceId: form.myVoiceId,
          },
          { userId, displayName }
        );
      }
    },
    [profile?.deviceUserId, profile?.displayName]
  );

  // Open a chat for a conversation (from the list OR straight after pairing).
  // The relay identity (userId/displayName) is OURS (from the profile); the
  // conversation's contact name is the header title.
  function openConversation(convo, identity) {
    const userId = identity?.userId || profile?.deviceUserId;
    const displayName = identity?.displayName || profile?.displayName || 'Ja';
    setChatSession({
      roomId: convo.roomId,
      userId,
      displayName,
      myVoiceId: convo.myVoiceId,
      contactVoiceId: convo.contactVoiceId,
      title: convo.contactName,
    });
    setView(VIEW.chat);
  }

  // List → open a tapped conversation. ConversationsScreen hands us roomId +
  // voices + contactName; we attach our own relay identity.
  const handleOpenConversation = useCallback(
    (session) => {
      openConversation(
        {
          roomId: session.roomId,
          contactName: session.contactName,
          contactVoiceId: session.contactVoiceId,
          myVoiceId: session.myVoiceId,
        },
        null
      );
    },
    [profile?.deviceUserId, profile?.displayName]
  );

  // Leaving a chat returns to the list (which refreshes via the view effect).
  function leaveChat() {
    setChatSession(null);
    setView(VIEW.list);
  }

  // --- gated splash: don't render screens until the DB is open + migrated ---
  if (!dbReady || !fontsReady) {
    return (
      <View style={[styles.screen, styles.splash]}>
        <StatusBar style="dark" />
        <GradientOrb color={gradientOrbs.lavender} size={340} opacity={0.07} style={styles.splashOrb} />
        <Wordmark size={32} motif="eleven" />
        <ActivityIndicator color={colors.ink} style={styles.splashSpinner} />
      </View>
    );
  }

  // --- live chat: ChatScreen owns the whole screen (brings its own header) ---
  if (view === VIEW.chat && chatSession) {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <ChatScreen
          roomId={chatSession.roomId}
          userId={chatSession.userId}
          displayName={chatSession.displayName}
          myVoiceId={chatSession.myVoiceId}
          contactVoiceId={chatSession.contactVoiceId}
          title={chatSession.title}
        />
        <TouchableOpacity
          style={styles.leaveBtn}
          onPress={leaveChat}
          hitSlop={sizes.hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Wróć do listy rozmów"
        >
          <Text style={styles.leaveText}>Rozmowy</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- "Mów" (speak with emotion) — reachable from the list's header --------
  if (view === VIEW.speak) {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <SubHeader title="Mów" status={status} connected={connected} onBack={() => setView(VIEW.list)} />
        <SpeakScreen voices={voices} status={status} error={error} />
      </View>
    );
  }

  // --- new-chat setup (pairing code + voice pickers) ------------------------
  if (view === VIEW.newChat) {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <SubHeader title="Nowa rozmowa" status={status} connected={connected} onBack={() => setView(VIEW.list)} />
        <ChatSetupScreen voices={voices} connected={connected} onConnect={handleConnect} />
      </View>
    );
  }

  // --- default: the conversation list (the home) ----------------------------
  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ConversationsScreen
        conversations={conversations}
        onOpenConversation={handleOpenConversation}
        onNewChat={() => setView(VIEW.newChat)}
        onSpeak={() => setView(VIEW.speak)}
      />
    </View>
  );
}

// A compact sub-screen header with a back action + live connection status, used
// by the "Mów" and "Nowa rozmowa" screens (which don't carry their own header).
function SubHeader({ title, status, connected, onBack }) {
  return (
    <View style={styles.subHeader}>
      <GradientOrb color={gradientOrbs.lavender} size={300} opacity={0.06} style={styles.headerOrb} />
      <View style={styles.subHeaderTop}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          hitSlop={sizes.hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Wróć do listy rozmów"
        >
          <Text style={styles.backIcon}>‹</Text>
          <Text style={styles.backText} numberOfLines={1}>Rozmowy</Text>
        </TouchableOpacity>
        <Text style={styles.subHeaderTitle} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {/* Spacer keeps the title visually centered against the back button. */}
        <View style={styles.backBtnSpacer} />
      </View>
      <View style={styles.statusRow} accessibilityRole="text">
        <View style={[styles.statusDot, { backgroundColor: connected ? colors.success : colors.error }]} />
        <Text style={styles.status}>{status}</Text>
      </View>
    </View>
  );
}

// ===========================================================================
// SpeakScreen — milestone-1 "speak with emotion" (behavior unchanged).
// Receives the shared voices/status/error from the shell; owns its own
// selected voice + the full TTS playback lifecycle exactly as before.
// ===========================================================================
function SpeakScreen({ voices, status, error: connError }) {
  const [voiceId, setVoiceId] = useState(null);
  const [text, setText] = useState('Hej! Ale super, że to w końcu działa! 😄');
  const [error, setError] = useState('');
  const [play, setPlay] = useState(PLAY.idle); // idle | loading | playing
  const playerRef = useRef(null);
  const subRef = useRef(null);

  // Live, on-device emotion analysis of whatever is typed.
  const meta = analyzeForSpeech(text, { models: MODELS });

  // Preselect the first voice once the shared list arrives.
  useEffect(() => {
    if (!voiceId && voices.length) setVoiceId(voices[0].voice_id);
  }, [voices, voiceId]);

  // Surface a connection error from the shell as this screen's error banner.
  useEffect(() => { if (connError) setError(connError); }, [connError]);

  // Stop playback when this screen unmounts (e.g. switching back to the list).
  useEffect(() => () => { teardownPlayer(); }, []);

  function teardownPlayer() {
    try { subRef.current?.remove?.(); } catch {}
    subRef.current = null;
    try { playerRef.current?.remove(); } catch {}
    playerRef.current = null;
  }

  function speak() {
    if (!voiceId) return;
    // Tapping the button while audio is loading/playing stops it — useful when
    // the message is long and you just want quiet.
    if (play !== PLAY.idle) {
      teardownPlayer();
      setPlay(PLAY.idle);
      return;
    }

    setError('');
    setPlay(PLAY.loading);
    try {
      const q =
        `text=${encodeURIComponent(meta.ttsText)}` +
        `&voiceId=${encodeURIComponent(voiceId)}` +
        `&modelId=${encodeURIComponent(meta.modelId)}` +
        `&stability=${meta.voiceSettings.stability}` +
        `&style=${meta.voiceSettings.style}`;
      teardownPlayer();
      const player = createAudioPlayer(`${BACKEND}/api/tts?${q}`);
      playerRef.current = player;

      // Drive the button state from real playback status (load -> play -> done).
      subRef.current = player.addListener('playbackStatusUpdate', (s) => {
        if (playerRef.current !== player) return; // ignore a superseded player
        if (s?.error) {
          setError('Błąd odtwarzania: ' + s.error);
          setPlay(PLAY.idle);
          return;
        }
        if (s?.didJustFinish) {
          setPlay(PLAY.idle);
          return;
        }
        if (s?.playing) setPlay(PLAY.playing);
        else if (s?.isLoaded && !s?.isBuffering) setPlay(PLAY.playing);
      });

      player.play();
    } catch (e) {
      setError('Błąd odtwarzania: ' + (e?.message || e));
      setPlay(PLAY.idle);
    }
  }

  const connected = voices.length > 0;
  const hasText = text.trim().length > 0;
  const canSpeak = connected && hasText;
  const busy = play !== PLAY.idle;
  const emColor = emotionColors[meta.emotion] || colors.muted;

  const speakLabel =
    play === PLAY.loading ? 'Przygotowuję…' :
    play === PLAY.playing ? 'Odtwarzam — dotknij, aby zatrzymać' :
    'Mów';

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {/* Message --------------------------------------------------------- */}
      <Text style={styles.label} accessibilityRole="text">Wiadomość</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Wpisz wiadomość, którą mam wypowiedzieć…"
        placeholderTextColor={colors.mutedSoft}
        multiline
        accessibilityLabel="Treść wiadomości do wypowiedzenia"
        accessibilityHint="Wpisany tekst zostanie zamieniony na mowę z dopasowaną emocją."
      />

      {/* Detected emotion ----------------------------------------------- */}
      <View
        style={styles.emotionCard}
        accessibilityRole="text"
        accessibilityLabel={
          hasText
            ? `Wykryta emocja: ${PL[meta.emotion]}, siła ${Math.round(meta.intensity * 100)} procent`
            : 'Brak tekstu do analizy emocji'
        }
      >
        <View style={styles.emotionTop}>
          <Text style={styles.emotionBadge}>
            {EMOJI[meta.emotion]}  {cap(PL[meta.emotion])}
          </Text>
          <Text style={styles.emotionModel}>
            {meta.modelId === 'eleven_v3' ? 'v3 · emocje' : 'multilingual'}
          </Text>
        </View>

        {/* Intensity meter — a quick visual read of how strong the emotion is. */}
        <View style={styles.meterTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View
            style={[
              styles.meterFill,
              { width: `${Math.round(meta.intensity * 100)}%`, backgroundColor: emColor },
            ]}
          />
        </View>
        <View style={styles.emotionBottom}>
          <Text style={styles.emotionDim}>siła {Math.round(meta.intensity * 100)}%</Text>
          {meta.tags.length > 0 && (
            <Text style={styles.tags} numberOfLines={1}>
              {meta.tags.join(' ')}
            </Text>
          )}
        </View>
      </View>

      {/* Voice ----------------------------------------------------------- */}
      <Text style={styles.label} accessibilityRole="text">Głos</Text>
      {connected ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.voices}
          contentContainerStyle={styles.voicesContent}
        >
          {voices.map((v) => {
            const active = v.voice_id === voiceId;
            const name = v.name.split(' - ')[0];
            return (
              <TouchableOpacity
                key={v.voice_id}
                style={[styles.voiceChip, active && styles.voiceChipActive]}
                onPress={() => setVoiceId(v.voice_id)}
                hitSlop={sizes.hitSlop}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Głos ${name}`}
              >
                <Text style={[styles.voiceText, active && styles.voiceTextActive]} numberOfLines={1}>
                  {name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : (
        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderText}>
            {status === 'Brak połączenia'
              ? 'Brak głosów — najpierw połącz się z serwerem.'
              : 'Wczytuję dostępne głosy…'}
          </Text>
        </View>
      )}

      {/* Primary action -------------------------------------------------- */}
      <TouchableOpacity
        style={[
          styles.speakBtn,
          busy && styles.speakBtnBusy,
          !canSpeak && !busy && styles.speakBtnOff,
        ]}
        onPress={speak}
        disabled={!canSpeak && !busy}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSpeak && !busy, busy }}
        accessibilityLabel={
          busy ? speakLabel : 'Mów'
        }
        accessibilityHint={
          !connected ? 'Niedostępne — brak połączenia z serwerem.'
          : !hasText ? 'Niedostępne — najpierw wpisz wiadomość.'
          : 'Wypowiada wpisaną wiadomość z wykrytą emocją.'
        }
      >
        {busy && <ActivityIndicator color={colors.onPrimary} style={styles.spinner} />}
        {!busy && <Text style={styles.speakIcon}>▶︎</Text>}
        <Text style={styles.speakText} numberOfLines={1}>{speakLabel}</Text>
      </TouchableOpacity>

      {!canSpeak && !busy && (
        <Text style={styles.hint}>
          {!connected ? 'Połącz się z serwerem, aby móc odtworzyć.' : 'Wpisz wiadomość, aby móc ją wypowiedzieć.'}
        </Text>
      )}

      {/* Error state ----------------------------------------------------- */}
      {!!error && (
        <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={styles.errorTitle}>Coś poszło nie tak</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Text style={styles.footer}>backend: {BACKEND}</Text>
    </ScrollView>
  );
}

// ===========================================================================
// ChatSetupScreen — pair two phones, then open <ChatScreen/> via onConnect.
// Collects: a shared pairing code (roomId), MY display name, the CONTACT's
// label (shown in the list/header), MY voice, and the CONTACT's voice. Once a
// code + a contact name + both voices are chosen, "Połącz" reports a form up:
//   { roomId, displayName, contactName, myVoiceId, contactVoiceId }
// The shell (App) create-or-resumes the conversation row and opens the chat.
// ===========================================================================
function ChatSetupScreen({ voices, connected, onConnect }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [myVoiceId, setMyVoiceId] = useState(null);
  const [contactVoiceId, setContactVoiceId] = useState(null);

  // Preselect sensible defaults once voices arrive: my voice = first,
  // contact voice = second (or first if only one) so a tester can go fast.
  useEffect(() => {
    if (!voices.length) return;
    if (!myVoiceId) setMyVoiceId(voices[0].voice_id);
    if (!contactVoiceId) setContactVoiceId((voices[1] || voices[0]).voice_id);
  }, [voices, myVoiceId, contactVoiceId]);

  const roomId = code.trim();
  const displayName = name.trim() || 'Ja';
  const contactName = contact.trim();
  const ready = connected && roomId.length > 0 && contactName.length > 0 && !!myVoiceId && !!contactVoiceId;

  function connect() {
    if (!ready) return;
    onConnect?.({
      roomId,
      displayName,
      contactName,
      myVoiceId,
      contactVoiceId,
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {/* Pairing code ---------------------------------------------------- */}
      <Text style={styles.label} accessibilityRole="text">Kod pokoju</Text>
      <TextInput
        style={styles.inputShort}
        value={code}
        onChangeText={setCode}
        placeholder="np. kuchnia-2207"
        placeholderTextColor={colors.mutedSoft}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Kod pokoju do sparowania dwóch telefonów"
        accessibilityHint="Wpiszcie ten sam kod na obu telefonach, aby się połączyć."
      />
      <Text style={styles.hintLeft}>
        Wpiszcie ten sam kod na obu telefonach.
      </Text>

      {/* Contact name (the conversation label) --------------------------- */}
      <Text style={styles.label} accessibilityRole="text">Nazwa rozmowy</Text>
      <TextInput
        style={styles.inputShort}
        value={contact}
        onChangeText={setContact}
        placeholder="np. Mama"
        placeholderTextColor={colors.mutedSoft}
        autoCorrect={false}
        accessibilityLabel="Nazwa rozmowy widoczna na liście"
        accessibilityHint="Etykieta tej rozmowy na liście rozmów."
      />

      {/* My name --------------------------------------------------------- */}
      <Text style={styles.label} accessibilityRole="text">Twoja nazwa</Text>
      <TextInput
        style={styles.inputShort}
        value={name}
        onChangeText={setName}
        placeholder="np. Franek"
        placeholderTextColor={colors.mutedSoft}
        autoCorrect={false}
        accessibilityLabel="Twoja nazwa widoczna dla rozmówcy"
      />

      {/* My voice -------------------------------------------------------- */}
      <Text style={styles.label} accessibilityRole="text">Mój głos</Text>
      <VoicePicker
        voices={voices}
        connected={connected}
        selectedId={myVoiceId}
        onSelect={setMyVoiceId}
        groupLabel="Wybór mojego głosu"
      />

      {/* Contact voice --------------------------------------------------- */}
      <Text style={styles.label} accessibilityRole="text">Głos rozmówcy</Text>
      <VoicePicker
        voices={voices}
        connected={connected}
        selectedId={contactVoiceId}
        onSelect={setContactVoiceId}
        groupLabel="Wybór głosu rozmówcy"
      />

      {/* Connect --------------------------------------------------------- */}
      <TouchableOpacity
        style={[styles.speakBtn, !ready && styles.speakBtnOff]}
        onPress={connect}
        disabled={!ready}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
        accessibilityLabel="Połącz i otwórz czat"
        accessibilityHint={
          !connected ? 'Niedostępne — brak połączenia z serwerem.'
          : !roomId ? 'Niedostępne — najpierw wpisz kod pokoju.'
          : !contactName ? 'Niedostępne — najpierw podaj nazwę rozmowy.'
          : 'Otwiera rozmowę z wybranymi głosami.'
        }
      >
        <Text style={styles.speakIcon}>💬</Text>
        <Text style={styles.speakText} numberOfLines={1}>Połącz</Text>
      </TouchableOpacity>

      {!ready && (
        <Text style={styles.hint}>
          {!connected ? 'Połącz się z serwerem, aby rozpocząć czat.'
            : !roomId ? 'Wpisz kod pokoju, aby się połączyć.'
            : !contactName ? 'Podaj nazwę rozmowy, aby kontynuować.'
            : 'Wybierz oba głosy, aby kontynuować.'}
        </Text>
      )}

      <Text style={styles.footer}>backend: {BACKEND}</Text>
    </ScrollView>
  );
}

// Horizontal voice chips, reused for both "my voice" and "contact voice".
function VoicePicker({ voices, connected, selectedId, onSelect, groupLabel }) {
  if (!connected) {
    return (
      <View style={styles.placeholderBox}>
        <Text style={styles.placeholderText}>
          Brak głosów — najpierw połącz się z serwerem.
        </Text>
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.voices}
      contentContainerStyle={styles.voicesContent}
      accessibilityRole="radiogroup"
      accessibilityLabel={groupLabel}
    >
      {voices.map((v) => {
        const active = v.voice_id === selectedId;
        const name = v.name.split(' - ')[0];
        return (
          <TouchableOpacity
            key={v.voice_id}
            style={[styles.voiceChip, active && styles.voiceChipActive]}
            onPress={() => onSelect(v.voice_id)}
            hitSlop={sizes.hitSlop}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Głos ${name}`}
          >
            <Text style={[styles.voiceText, active && styles.voiceTextActive]} numberOfLines={1}>
              {name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// Small helpers ------------------------------------------------------------
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Polish plural: 1 głos / 2-4 głosy / 5+ głosów (also handles the teens).
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (n === 1) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },

  // Splash — centered wordmark + spinner while the DB opens / fonts load.
  splash: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  splashOrb: { position: 'absolute', top: '30%' },
  splashSpinner: { marginTop: spacing.lg },

  // Sub-screen header (Mów / Nowa rozmowa): canvas band, hairline divider,
  // back action + centered title + connection status. Clips the GradientOrb.
  subHeader: {
    paddingTop: sizes.headerTopPad,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    borderBottomWidth: sizes.hairlineWidth,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.canvas,
    overflow: 'hidden',
  },
  headerOrb: { position: 'absolute', top: -180, left: -90 },
  subHeaderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subHeaderTitle: { ...type.titleMd, color: colors.ink, flexShrink: 1, textAlign: 'center' },
  // Back action — quiet, ink chevron + label, no fill (subordinate to content).
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: sizes.tapMin,
    paddingRight: spacing.sm,
    minWidth: 96,
  },
  // A matching-width spacer balances the back button so the title centers.
  backBtnSpacer: { minWidth: 96 },
  backIcon: { color: colors.ink, fontSize: 28, lineHeight: 30, marginRight: spacing.xxs },
  backText: { ...type.button, color: colors.ink },

  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill, marginRight: spacing.xs },
  status: { color: colors.muted, ...type.caption },

  body: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.section },

  // Section labels — overline (UPPERCASE, semibold, wide tracking).
  label: {
    color: colors.muted,
    ...type.overline,
    marginTop: spacing.sm,
  },

  // Input — surface, hairline-strong border, md radius (per brand recipe).
  input: {
    backgroundColor: colors.surface,
    color: colors.ink,
    borderRadius: radius.md,
    borderWidth: sizes.hairlineWidth,
    borderColor: colors.hairlineStrong,
    paddingHorizontal: sizes.inputPadH,
    paddingVertical: sizes.inputPadV,
    ...type.body,
    minHeight: sizes.inputMinHeight + spacing.xxl, // tall multiline message box
    textAlignVertical: 'top',
  },
  // Single-line inputs (pairing code, name) don't need the tall message box.
  inputShort: {
    backgroundColor: colors.surface,
    color: colors.ink,
    borderRadius: radius.md,
    borderWidth: sizes.hairlineWidth,
    borderColor: colors.hairlineStrong,
    paddingHorizontal: sizes.inputPadH,
    paddingVertical: sizes.inputPadV,
    ...type.body,
    minHeight: sizes.inputMinHeight,
  },

  // Emotion card — surface + hairline border + xl radius (brand "card" recipe).
  emotionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: sizes.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  emotionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  emotionBadge: { color: colors.ink, ...type.titleSm },
  emotionModel: { color: colors.muted, ...type.caption },
  meterTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceStrong,
    overflow: 'hidden',
  },
  meterFill: { height: 8, borderRadius: radius.pill },
  emotionBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  emotionDim: { color: colors.muted, ...type.caption },
  tags: { color: colors.muted, ...type.caption, flexShrink: 1, marginLeft: spacing.md, textAlign: 'right' },

  // Voices — chips: surface + hairline; selected = ink fill, onPrimary text.
  voices: { flexGrow: 0 },
  voicesContent: { paddingVertical: spacing.xs },
  voiceChip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    minHeight: sizes.tapMin,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    marginRight: spacing.sm,
    borderWidth: sizes.hairlineWidth,
    borderColor: colors.hairline,
  },
  voiceChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  voiceText: { color: colors.muted, ...type.bodyStrong },
  voiceTextActive: { color: colors.onPrimary },

  placeholderBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: sizes.hairlineWidth,
    borderColor: colors.hairline,
    borderStyle: 'dashed',
    padding: spacing.lg,
  },
  placeholderText: { color: colors.muted, ...type.bodySm },

  // Primary action — ink pill CTA (bg primary, onPrimary text, height 48–52).
  speakBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    minHeight: sizes.ctaHeight,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  speakBtnBusy: { backgroundColor: colors.ink }, // pressed/active → darker ink
  speakBtnOff: { backgroundColor: colors.mutedSoft }, // disabled, still readable
  speakIcon: { color: colors.onPrimary, fontSize: 18, marginRight: spacing.sm },
  spinner: { marginRight: spacing.sm },
  speakText: { color: colors.onPrimary, ...type.button, flexShrink: 1, textAlign: 'center' },

  hint: { color: colors.muted, ...type.caption, textAlign: 'center', marginTop: spacing.xs },
  hintLeft: { color: colors.muted, ...type.caption, marginTop: spacing.xs },

  // Error — restrained: error color reserved for status, soft tinted surface.
  errorBox: {
    backgroundColor: colors.surface,
    borderColor: colors.error,
    borderWidth: sizes.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  errorTitle: { color: colors.error, ...type.bodyStrong },
  errorText: { color: colors.body, ...type.caption },

  footer: { color: colors.mutedSoft, ...type.caption, marginTop: spacing.xl, textAlign: 'center' },

  // "Rozmowy" floats over ChatScreen's own header (which we can't edit). Pinned
  // top-right in the notch-clear band; sits above ChatScreen's bottom-aligned
  // header content (title + #room), so it doesn't collide with them.
  // Ink pill — the same CTA language as the rest of the app.
  leaveBtn: {
    position: 'absolute',
    top: sizes.headerTopPad - 6,
    right: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.base,
    minHeight: sizes.tapMin - 8,
    justifyContent: 'center',
  },
  leaveText: { color: colors.onPrimary, ...type.button },
});
