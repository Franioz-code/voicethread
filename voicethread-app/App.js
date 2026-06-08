// VoiceThread — App home.
// ----------------------------------------------------------------------------
// A simple home with two modes, toggled by a tab bar in the header:
//
//   • "Mów"  — the milestone-1 "speak with emotion" playground (unchanged):
//              on-device emotion detection -> backend (ElevenLabs) TTS -> playback.
//   • "Czat" — pair two phones: enter a shared pairing code, pick MY voice and the
//              CONTACT's voice, then open the iMessage-style chat (milestone 2).
//
// The milestone-1 pipeline is preserved verbatim inside <SpeakScreen/> — same
// gesture/audio handlers, same network calls — it's just no longer the top-level
// component. Both modes share ONE backend connection + ONE voices fetch, lifted
// into <HomeScreen/> so we don't hit /api/voices twice.
//
// VISUAL LANGUAGE — re-skinned to ElevenLabs (see docs/ELEVENLABS-BRAND.md):
// monochrome warm-stone canvas, ink pill CTAs, hairline borders, generous
// spacing on a 4px grid, Inter type (light/tight display, positive-tracked body),
// and a single soft pastel GradientOrb as atmosphere behind the wordmark. All
// behaviour, network contracts and accessibility are preserved verbatim — this
// is a re-skin, not a rebuild.

import { useEffect, useRef, useState } from 'react';
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

const MODE = { speak: 'speak', chat: 'chat' };

// ===========================================================================
// HomeScreen — app shell: status header, mode tabs, shared voices fetch.
// ===========================================================================
export default function App() {
  // Load Inter for the brand type scale. Degrades to system font (returns true)
  // if the packages are unavailable, so first paint is never blocked.
  useFont();

  const [mode, setMode] = useState(MODE.speak);
  const [status, setStatus] = useState('Łączę z serwerem…');
  const [voices, setVoices] = useState([]);
  const [error, setError] = useState('');
  // When set, a chat is live and takes over the WHOLE screen (ChatScreen brings
  // its own header). null = still on the setup form. Lifted here so the chat can
  // render without the app's header/tabs stacking on top of ChatScreen's header.
  const [chatSession, setChatSession] = useState(null);

  // ONE voices fetch shared by both modes (Speak preselects the first voice;
  // Chat lets you pick MY + CONTACT voice from the same list).
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

  // Live chat: hand the entire screen to ChatScreen (it owns its own header),
  // with a small "Rozłącz" overlay to return to the setup form.
  if (mode === MODE.chat && chatSession) {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <ChatScreen
          roomId={chatSession.roomId}
          userId={chatSession.userId}
          displayName={chatSession.displayName}
          myVoiceId={chatSession.myVoiceId}
          contactVoiceId={chatSession.contactVoiceId}
        />
        <TouchableOpacity
          style={styles.leaveBtn}
          onPress={() => setChatSession(null)}
          hitSlop={sizes.hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Rozłącz i wróć do ustawień czatu"
        >
          <Text style={styles.leaveText}>Rozłącz</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        {/* Signature pastel bloom behind the wordmark — atmosphere only:
            low opacity, large + soft, pointer-transparent, hidden from a11y. */}
        <GradientOrb
          color={gradientOrbs.lavender}
          size={340}
          opacity={0.07}
          style={styles.headerOrb}
        />

        {/* Wordmark carries the title (Inter Light + tight tracking + "11" mark)
            and its own accessibilityRole="header" / label="VoiceThread". */}
        <Wordmark size={32} motif="eleven" />

        <View style={styles.statusRow} accessibilityRole="text">
          <View
            style={[styles.statusDot, { backgroundColor: connected ? colors.success : colors.error }]}
          />
          <Text style={styles.status}>{status}</Text>
        </View>

        {/* Mode tabs --------------------------------------------------------- */}
        <View style={styles.tabs} accessibilityRole="tablist">
          <Tab label="Mów" active={mode === MODE.speak} onPress={() => setMode(MODE.speak)} />
          <Tab label="Czat" active={mode === MODE.chat} onPress={() => setMode(MODE.chat)} />
        </View>
      </View>

      {/* Body switches on the active mode. Each screen is self-contained;
          only the connection state + voices list are shared. */}
      {mode === MODE.speak ? (
        <SpeakScreen voices={voices} status={status} error={error} />
      ) : (
        <ChatSetupScreen voices={voices} connected={connected} onJoin={setChatSession} />
      )}
    </View>
  );
}

// Minimal tab: text-only, transparent. Active = ink text on a hairline-bordered
// pill; inactive = muted text, no border. (Brand: "minimal tabs" recipe.)
function Tab({ label, active, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.tab, active && styles.tabActive]}
      onPress={onPress}
      hitSlop={sizes.hitSlop}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Tryb ${label}`}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ===========================================================================
// SpeakScreen — milestone-1 "speak with emotion" (behavior unchanged).
// Receives the shared voices/status/error from HomeScreen; owns its own
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

  // Stop playback when this screen unmounts (e.g. switching to Czat).
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
// ChatSetupScreen — pair two phones, then open <ChatScreen/>.
// Collects: a shared pairing code (roomId), MY display name, MY voice, and the
// CONTACT's voice. Once a code + both voices are chosen, "Połącz" mounts the
// chat. Props handed to ChatScreen (signature owned by features):
//   roomId, userId, displayName, myVoiceId, contactVoiceId  (+ optional title)
// ===========================================================================
function ChatSetupScreen({ voices, connected, onJoin }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
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
  const ready = connected && roomId.length > 0 && !!myVoiceId && !!contactVoiceId;

  // A stable per-device id for the relay. Persisting isn't needed for the PoC;
  // a fresh id per session is fine and keeps two phones distinct.
  const userIdRef = useRef(null);
  if (!userIdRef.current) {
    userIdRef.current = `u-${Math.random().toString(36).slice(2, 9)}`;
  }

  function connect() {
    if (!ready) return;
    onJoin({
      roomId,
      userId: userIdRef.current,
      displayName,
      myVoiceId,
      contactVoiceId,
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {/* Pairing code ---------------------------------------------------- */}
      <Text style={styles.label} accessibilityRole="text">Kod pokoju</Text>
      <TextInput
        style={styles.input}
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

  header: {
    paddingTop: sizes.headerTopPad,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomWidth: sizes.hairlineWidth,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.canvas,
    overflow: 'hidden', // clip the GradientOrb bloom to the header band
  },
  // Soft pastel bloom behind the wordmark — pulled up/left so only its lower
  // edge feathers into the header (atmosphere, not a shape).
  headerOrb: {
    position: 'absolute',
    top: -180,
    left: -90,
  },

  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill, marginRight: spacing.xs },
  status: { color: colors.muted, ...type.caption },

  // Mode tabs — minimal: transparent, hairline border, ink text + pill when
  // selected, muted when not. (Brand "minimal tabs" recipe.)
  tabs: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    minHeight: sizes.tapMin,
    borderRadius: radius.pill,
    borderWidth: sizes.hairlineWidth,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  tabActive: {
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  tabText: { color: colors.muted, ...type.button },
  tabTextActive: { color: colors.ink },

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

  // "Rozłącz" floats over ChatScreen's own header (which we can't edit). Pinned
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
