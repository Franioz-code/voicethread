# emotion-service — emotion from VOICE (emotion2vec)

A tiny **optional** local microservice that detects emotion from the *sound* of a
recording (not the words), so a **dictated** message carries *how* you said it.

- Model: **[emotion2vec+](https://huggingface.co/emotion2vec/emotion2vec_plus_large)** (open-source SER) via [FunASR](https://github.com/modelscope/FunASR).
- Endpoint: `POST /emotion` (raw audio bytes) → `{ emotion, intensity, raw }`.
- The Node backend proxies to it at `POST /api/emotion`. **If this service isn't
  running, the app falls back to text-based emotion** — nothing breaks.

## Run

```bash
cd emotion-service
python -m venv .venv
./.venv/Scripts/python -m pip install -r requirements.txt   # torch/torchaudio + funasr
./.venv/Scripts/python app.py                               # serves on 127.0.0.1:8200
```
First run downloads the model (~hundreds of MB). CPU-only is fine. Then start the
backend (`npm start`) and the app — dictated messages now get their emotion from
your voice.

## ⚠️ Windows on ARM (ARM64)

`torchaudio` (needed by FunASR) has **no native ARM64 wheel**. If your machine is
Windows‑ARM, create the venv with an **x64 Python** (runs under emulation):

```bash
# install an x64 Python (per-user, no admin), e.g. python.org 3.11 amd64, then:
"C:/Users/<you>/python311-x64/python.exe" -m venv .venv
./.venv/Scripts/python -m pip install -r requirements.txt
```

(`requirements.txt` pulls torch/torchaudio from the PyTorch CPU index via
`--extra-index-url https://download.pytorch.org/whl/cpu`.)

## Notes
- Audio is decoded with a **bundled ffmpeg** (`imageio-ffmpeg`) — no system install.
- Labels are mapped to the app's set (joy/sadness/anger/fear/surprise/neutral).
- Privacy: runs **fully locally**; audio never leaves your machine for emotion.
