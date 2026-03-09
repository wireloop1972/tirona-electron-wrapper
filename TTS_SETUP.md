# Chatterbox Turbo TTS – Setup Guide

## Overview

The Tirona Electron wrapper bundles a local **Chatterbox Turbo** TTS server
based on [devnen/Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server).

- **Model:** Chatterbox Turbo (350M params, 1-step mel decoder)
- **Backend:** FastAPI on `http://127.0.0.1:4123`
- **Hardware:** NVIDIA GPU with CUDA (required)
- **Runtime:** Portable Mode CPython 3.10 + PyTorch CUDA (no system Python needed)

## Prerequisites

- **Python 3.10+** on your dev machine (used only during setup)
- **NVIDIA GPU** with up-to-date drivers
- **Git** for cloning the server repo
- **~10 GB** free disk space (PyTorch CUDA + deps)

## Quick Start

```powershell
npm run setup:tts
```

This runs `scripts/setup-tts-server.ps1`, which:

1. Clones `devnen/Chatterbox-TTS-Server` to `../Chatterbox-TTS-Server`
2. Runs Portable Mode setup with `--portable --nvidia`
3. Writes a locked `config.yaml` (Turbo engine, CUDA device, port 4123)
4. Copies the result into `tts-server/` within this project

### Options

```powershell
# Use existing clone (skip git pull)
.\scripts\setup-tts-server.ps1 -SkipClone

# Custom paths
.\scripts\setup-tts-server.ps1 -RepoPath "C:\dev\my-server" -OutputPath "my-tts"

# Custom port
.\scripts\setup-tts-server.ps1 -Port 5000
```

## config.yaml

The setup script writes a locked config. Key settings:

```yaml
server:
  host: "127.0.0.1"
  port: 4123
  open_browser: false          # No Web UI needed in-game

tts_engine:
  device: "cuda"               # CUDA only – no CPU/MPS fallback
  default_engine: "turbo"      # Turbo is the only engine

generation_defaults:
  temperature: 0.7
  exaggeration: 0.5
  cfg_weight: 0.5
  seed: -1
  speed_factor: 1.0
```

These defaults can be overridden per-request via the `localTTS.speak()` params argument.

## Testing

```bash
npm run test:tts
```

This opens a dedicated test page with:
- GPU detection indicator
- Server start/stop controls
- Generation parameter sliders (exaggeration, CFG, temperature, speed, seed)
- Preset text samples including paralinguistic tags
- Character count with 300-char soft warning (Turbo's known input limit)

### Manual Server Test

```powershell
cd tts-server
.\python_embedded\python.exe server.py

# In another terminal:
curl http://127.0.0.1:4123/api/ui/initial-data
curl -X POST http://127.0.0.1:4123/v1/audio/speech `
  -H "Content-Type: application/json" `
  -d '{"input":"Hello world","response_format":"wav"}' `
  --output test.wav
```

## API Endpoints

### OpenAI-compatible (simple)

```
POST /v1/audio/speech
{ "input": "text", "voice": "default", "response_format": "wav" }
```

### Parameterized (full control)

```
POST /tts
{
  "text": "...",
  "voice_mode": "predefined",
  "predefined_voice_id": "default",
  "output_format": "wav",
  "exaggeration": 0.5,
  "cfg_weight": 0.5,
  "temperature": 0.7,
  "speed_factor": 1.0,
  "seed": -1
}
```

### Other Endpoints

- `GET /api/ui/initial-data` – comprehensive health/status check
- `GET /get_predefined_voices` – list available voices

## Architecture

```
Electron Main Process
  └─ src/tts-manager.ts
       ├─ detectNvidiaGpu() via src/gpu-detect.ts
       ├─ Spawns: tts-server/python_embedded/python.exe server.py
       ├─ Waits for health at /api/ui/initial-data
       └─ Proxies speak requests via IPC → HTTP to localhost:4123

Renderer (Next.js)
  └─ window.localTTS.speak(text, voice, params)
       → IPC → main process → POST /v1/audio/speech or /tts
       → audio saved to temp file → tts-audio:// protocol → Audio()
```

## Paralinguistic Tags (Turbo)

Turbo supports inline tags for natural speech reactions:

```
"That was hilarious [laugh] I can't believe it!"
"Excuse me [cough] sorry about that."
"Well well [chuckle] look who showed up."
```

Use these in game dialogue for NPC flavor without separate audio assets.

## Known Limitations

- **Input length:** Turbo may hallucinate on text >300 characters. The server has
  built-in text chunking (`split_text` / `chunk_size`), but for game dialogue
  keep individual lines short.
- **First-run model download:** ~2 GB from HuggingFace on the player's first launch.
  Cached in `%APPDATA%` afterward.
- **CUDA only:** No CPU or AMD GPU fallback in this configuration.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `nvidia-smi` not found | Install NVIDIA drivers |
| Server times out on start | Check GPU has enough VRAM (4+ GB recommended) |
| HTTP 500 on /v1/audio/speech | Check server console for model loading errors |
| No audio output | Verify `response_format: "wav"` in request |
| Port 4123 in use | Kill orphan processes: `netstat -ano \| findstr :4123` |

## Updating the Server

```powershell
# Pull latest server code and rebuild
.\scripts\setup-tts-server.ps1
```

The setup script does `git pull` on the server repo before copying.
