# VoiceThread — emotion-from-voice microservice (emotion2vec via FunASR).
# ----------------------------------------------------------------------------
# A tiny local Flask service the Node backend calls (/api/emotion -> here).
# It runs the open-source emotion2vec+ Speech Emotion Recognition model on the
# RECORDED AUDIO and returns the detected emotion + intensity — so a dictated
# message's emotion comes from HOW you spoke, not from the transcribed words.
#
# Decode: any input (m4a/mp3/wav/ogg) is piped through ffmpeg (bundled via
# imageio-ffmpeg, no system install) to 16 kHz mono wav, then fed to the model.
#
# Run:  python app.py        (loads the model, then serves on 127.0.0.1:8200)
# The model downloads on first run (~hundreds of MB). CPU-only is fine.

import io
import os
import tempfile
import subprocess

from flask import Flask, request, jsonify
import numpy as np
import soundfile as sf
import imageio_ffmpeg
from funasr import AutoModel

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
MODEL_ID = "emotion2vec/emotion2vec_plus_base"  # SER, language-robust; downloaded from HF (fast CDN)

app = Flask(__name__)
_model = None


def get_model():
    global _model
    if _model is None:
        print(f"[emotion] loading {MODEL_ID} (first run downloads it)…", flush=True)
        _model = AutoModel(model=MODEL_ID, disable_update=True, hub="hf")  # HF hub (ModelScope is slow here)
        print("[emotion] model ready.", flush=True)
    return _model


def decode_to_wav(raw: bytes) -> bytes:
    """Any audio bytes -> 16 kHz mono WAV bytes via bundled ffmpeg (format auto-detected)."""
    p = subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
         "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"],
        input=raw, capture_output=True,
    )
    if p.returncode != 0 or not p.stdout:
        raise RuntimeError("ffmpeg decode failed: " + p.stderr.decode("utf-8", "ignore")[:200])
    return p.stdout


# emotion2vec labels (often bilingual, e.g. "生气/angry") -> our app's set.
def to_our_emotion(label: str) -> str:
    l = str(label).lower()
    if "happy" in l or "开心" in l:
        return "joy"
    if "sad" in l or "难" in l or "伤" in l:
        return "sadness"
    if "ang" in l or "怒" in l or "生气" in l:
        return "anger"
    if "fear" in l or "恐" in l or "怕" in l:
        return "fear"
    if "surpr" in l or "惊" in l:
        return "surprise"
    if "disg" in l or "厌" in l:
        return "anger"
    return "neutral"  # neutral / other / unknown


@app.get("/health")
def health():
    return jsonify(ok=True, model_loaded=_model is not None, model=MODEL_ID)


@app.post("/emotion")
def emotion():
    raw = request.get_data()
    if not raw:
        return jsonify(error="no audio"), 400
    try:
        wav = decode_to_wav(raw)
        samples, _sr = sf.read(io.BytesIO(wav), dtype="float32")
    except Exception as e:
        return jsonify(error="decode: " + str(e)), 400

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    try:
        sf.write(tmp.name, samples, 16000)
        tmp.close()
        res = get_model().generate(tmp.name, granularity="utterance", extract_embedding=False)
    except Exception as e:
        return jsonify(error="model: " + str(e)), 500
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    rec = (res or [{}])[0]
    labels = rec.get("labels") or []
    scores = rec.get("scores") or []
    if not labels:
        return jsonify(emotion="neutral", intensity=0.0)
    top = int(np.argmax(scores))
    return jsonify(
        emotion=to_our_emotion(labels[top]),
        intensity=round(float(scores[top]), 3),
        raw={"labels": [str(x) for x in labels], "scores": [round(float(s), 3) for s in scores]},
    )


if __name__ == "__main__":
    get_model()  # load up-front so the first request is fast
    app.run(host="127.0.0.1", port=8200, threaded=True)
