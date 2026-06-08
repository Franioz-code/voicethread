// VoiceThread — useVoiceClone: record a sample and clone YOUR voice (IVC).
// ----------------------------------------------------------------------------
// Records a ~30-60s sample with expo-audio, then POSTs the raw audio to the
// backend /api/voices/add (ElevenLabs Instant Voice Cloning). On success the
// backend returns { voiceId } which becomes the user's own voice, so a peer
// hears their messages in their REAL voice.
//
// IVC REQUIRES A PAID ElevenLabs PLAN — a free key returns HTTP 402 with a
// friendly, actionable message (handled in server.js), surfaced here as `error`.

import { useCallback, useState } from 'react';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import * as relay from '../../api/socket';

export function useVoiceClone() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 300); // { isRecording, durationMillis }
  const [busy, setBusy] = useState(false); // uploading/cloning
  const [error, setError] = useState(null);
  const [sampleUri, setSampleUri] = useState(null);

  const start = useCallback(async () => {
    setError(null);
    setSampleUri(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Brak dostępu do mikrofonu. Zezwól w ustawieniach telefonu.');
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

  const stop = useCallback(async () => {
    try { await recorder.stop(); } catch { /* ignore */ }
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = recorder.uri || null;
    setSampleUri(uri);
    return uri;
  }, [recorder]);

  /**
   * Upload the recorded sample to clone the voice.
   * @returns {Promise<{voiceId,name,requiresVerification}|null>} null on error (see `error`).
   */
  const clone = useCallback(async (name) => {
    const uri = sampleUri || recorder.uri;
    if (!uri) { setError('Najpierw nagraj próbkę głosu.'); return null; }
    setBusy(true);
    setError(null);
    try {
      const fileResp = await fetch(uri);
      const blob = await fileResp.blob();
      const url = `${relay.BACKEND_URL}/api/voices/add?name=${encodeURIComponent(name || 'Mój głos')}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/m4a' },
        body: blob,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        // 402 = needs a paid plan (friendly message from the backend).
        throw new Error(data.error || 'Nie udało się sklonować głosu.');
      }
      return data; // { voiceId, name, requiresVerification }
    } catch (e) {
      setError(e.message || 'Błąd klonowania.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [recorder, sampleUri]);

  const reset = useCallback(() => { setSampleUri(null); setError(null); }, []);

  return {
    start,
    stop,
    clone,
    reset,
    isRecording: state.isRecording,
    durationMillis: state.durationMillis || 0,
    hasSample: !!sampleUri,
    busy,
    error,
    clearError: () => setError(null),
  };
}
