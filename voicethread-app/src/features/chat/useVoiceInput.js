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
      return '';
    }
    setBusy(true);
    try {
      const fileResp = await fetch(uri);
      const blob = await fileResp.blob();
      const resp = await fetch(`${relay.BACKEND_URL}/api/stt`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/mp4' },
        body: blob,
      });
      if (!resp.ok) {
        let msg = 'Nie udało się przetranskrybować nagrania.';
        try { msg = (await resp.json()).error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      const { text } = await resp.json();
      const clean = (text || '').trim();
      if (!clean) setError('Nie rozpoznano mowy. Spróbuj jeszcze raz.');
      return clean;
    } catch (e) {
      setError(e.message || 'Błąd transkrypcji.');
      return '';
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
