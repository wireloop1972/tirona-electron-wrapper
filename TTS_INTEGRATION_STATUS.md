# Chatterbox TTS Integration Status

## ✅ COMPLETED

### 1. Chatterbox Integration
- Chatterbox TTS server bundled in `tts-binaries/chatterbox_server/`
- OpenAI-compatible API at `http://127.0.0.1:4123`
- GPU acceleration (CUDA) when available
- Voice cloning support via voice samples

### 2. Unified TTS Manager
- `tts-manager.ts` handles engine lifecycle
- Automatic process cleanup on app exit
- Health checking and readiness detection
- External server detection (for dev mode)

### 3. Legacy API Compatibility
- `window.electron.orpheus.*` API preserved for backwards compatibility
- Routes to Chatterbox internally
- `window.ORPHEUS_TTS_URL` points to Chatterbox port (4123)
- No changes required in existing Next.js code

### 4. Modern API
- `window.localTTS.*` unified API
- Engine selection via `localTTS.start('chatterbox')`
- Voice listing via `localTTS.getVoices()`
- Status monitoring via `localTTS.getStatus()`

## 🔧 CURRENT STATUS

### Server Configuration
- **Port:** 4123
- **Health Endpoint:** `/health`
- **Speech Endpoint:** `/v1/audio/speech`
- **Voices Endpoint:** `/voices`

### Build Artifacts
- **Binary:** `tts-binaries/chatterbox_server/chatterbox_server.exe`
- **Packaged Location:** `resources/chatterbox/` (in release)
- **Models:** Downloaded on first use to `%APPDATA%/Tirona/chatterbox_models`

## API Endpoints

### Health Check
```bash
curl http://127.0.0.1:4123/health
# Response: {"status": "healthy", "model_loaded": true, ...}
```

### Generate Speech
```bash
curl -X POST http://127.0.0.1:4123/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input": "Hello world", "response_format": "wav"}' \
  --output speech.wav
```

### List Voices
```bash
curl http://127.0.0.1:4123/voices
# Response: {"voices": [...], "count": N}
```

## Files Overview

| File | Description |
|------|-------------|
| `src/tts-manager.ts` | TTS engine lifecycle management |
| `src/main.ts` | IPC handlers for TTS API |
| `src/preload.ts` | Exposes TTS API to renderer |
| `types/electron.d.ts` | TypeScript definitions |
| `tts-binaries/chatterbox_server/` | Bundled Chatterbox binary |

## Orpheus Removal (Completed)

The following Orpheus components were removed:
- `orpheus-fastapi/` folder
- `tts-binaries/orpheus_server/` folder
- `src/orpheus-manager.ts` file
- `models/orpheus-3b-0.1-ft/` folder
- Orpheus-specific documentation

Legacy API naming preserved for backwards compatibility.

## Reference Resources

- Chatterbox GitHub: https://github.com/nari-ex/chatterbox
- Chatterbox API: OpenAI-compatible TTS API
- Distribution Guide: `DISTRIBUTION_GUIDE.md`
