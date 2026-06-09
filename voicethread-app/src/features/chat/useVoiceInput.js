// VoiceThread — useVoiceInput: dictate a message by voice.
// ----------------------------------------------------------------------------
// Records from the mic with expo-audio, then sends the raw audio to the backend
// /api/stt endpoint (ElevenLabs Scribe, language_code 'pl', multilingual) and
// returns the transcript. This powers BOTH the chat "🎙 powiedz" button and the
// hands-free reply loop. Privacy: audio is sent transiently to transcribe; the
// relay/server stores nothing (see server.js /api/stt).
//
// Upload mirrors the working web demo (public/index.html): POST the audio blob
// with its Content-Type as the raw body — no upload library needed.

import { useCallback, useState } from 'react';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import * as relay from '../../api/socket';

export function useVoiceInput() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250); // { isRecording, durationMillis, canRecord }
  const [busy, setBusy] = useState(false); // transcribing
  const [error, setError] = useState(null);

  // Begin recording (asks for mic permission the first time).
  const start = useCallback(async () => {
    setError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Brak dostępu do mikrofonu. Zezwól w ustawieniach.');
        return false;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      return true;
    } catch (e) {
      setError('Nie udało się rozpocząć nagrywania.');
      return false;
    }
  }, [recorder]);

  // Stop + transcribe. Returns the recognized text ('' if none / on error).
  const stopAndTranscribe = useCallback(async () => {
    let uri;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch {
      /* fall through — uri may still be set */
      uri = recorder.uri;
    }
    // Restore playback-friendly audio mode so TTS isn't muted on iOS.
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    if (!uri) {
      setError('Nagranie jest puste.');
      return { text: '', voiceEmotion: null };
    }
    setBusy(true);
    try {
      const fileResp = await fetch(uri);
      const blob = await fileResp.blob();
      const ct = blob.type || 'audio/mp4';
      // Transcribe (Scribe) AND detect emotion FROM THE VOICE (emotion2vec) from
      // the SAME recording, in parallel. The emotion service is OPTIONAL — if it
      // is down (/api/emotion → 503), voiceEmotion is null and the caller falls
      // back to text-based emotion, so dictation never breaks.
      const sttP = fetch(`${relay.BACKEND_URL}/api/stt`, {
        method: 'POST', headers: { 'Content-Type': ct }, body: blob,
      }).then(async (r) => {
        if (!r.ok) {
          let msg = 'Nie udało się przetranskrybować nagrania.';
          try { msg = (await r.json()).error || msg; } catch { /* ignore */ }
          throw new Error(msg);
        }
        return ((await r.json()).text || '').trim();
      });
      const emoP = fetch(`${relay.BACKEND_URL}/api/emotion`, {
        method: 'POST', headers: { 'Content-Type': ct }, body: blob,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d && d.emotion ? { emotion: d.emotion, intensity: d.intensity } : null))
        .catch(() => null);

      const [text, voiceEmotion] = await Promise.all([sttP, emoP]);
      if (!text) setError('Nie rozpoznano mowy. Spróbuj jeszcze raz.');
      return { text, voiceEmotion };
    } catch (e) {
      setError(e.message || 'Błąd transkrypcji.');
      return { text: '', voiceEmotion: null };
    } finally {
      setBusy(false);
    }
  }, [recorder]);

  // Abort without transcribing.
  const cancel = useCallback(async () => {
    try { await recorder.stop(); } catch { /* ignore */ }
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  }, [recorder]);

  return {
    start,
    stopAndTranscribe,
    cancel,
    isRecording: state.isRecording,
    durationMillis: state.durationMillis || 0,
    busy,
    error,
    clearError: () => setError(null),
  };
}
