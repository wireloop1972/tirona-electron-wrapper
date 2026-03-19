# Chatterbox Turbo TTS + faster-whisper STT – Setup Guide

## Overview

The Tirona Electron wrapper bundles a local **Chatterbox Turbo** TTS server
and **faster-whisper** STT on the same FastAPI process.

- **TTS Model:** Chatterbox Turbo (350M params, 1-step mel decoder)
- **STT Model:** faster-whisper `medium.en` (~1.5 GB, CTranslate2)
- **Backend:** FastAPI on `http://127.0.0.1:4123`
- **Hardware:** NVIDIA GPU with CUDA (required for TTS; STT falls back to CPU)
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
       ├─ Spawns: tts-server/python_embedded/python.exe launch_with_stt.py
       ├─ Waits for health at /api/ui/initial-data
       ├─ Proxies speak requests via IPC → HTTP to localhost:4123
       └─ Proxies transcribe requests via IPC → HTTP to localhost:4123

Renderer (Next.js)
  ├─ window.localTTS.speak(text, voice, params)
  │    → IPC → main process → POST /v1/audio/speech or /tts
  │    → returns base64 audio data URL
  └─ window.localSTT.transcribe(audioArrayBuffer)
       → IPC → main process → POST /stt (multipart)
       → returns { success, text, language, duration }
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

- **TTS input length:** Turbo may hallucinate on text >300 characters. The server
  has built-in text chunking (`split_text` / `chunk_size`), but for game dialogue
  keep individual lines short.
- **First-run model download:** TTS ~2 GB, STT ~1.5 GB from HuggingFace on the
  player's first launch (unless pre-downloaded during `npm run setup:tts`).
- **TTS is CUDA only:** No CPU or AMD GPU fallback for TTS.
- **STT falls back to CPU:** If CUDA is unavailable, STT uses CPU with int8
  quantization. Slower but functional.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `nvidia-smi` not found | Install NVIDIA drivers |
| Server times out on start | Check GPU has enough VRAM (4+ GB recommended) |
| HTTP 500 on /v1/audio/speech | Check server console for model loading errors |
| No audio output | Verify `response_format: "wav"` in request |
| Port 4123 in use | Kill orphan processes: `netstat -ano \| findstr :4123` |
| HTTP 503 on /stt | STT model failed to load; check console for `stt_addon` errors |
| STT returns empty text | Normal for silence; VAD filters non-speech audio |
| STT slow first request | Model is loading on first call (~5-10s); subsequent calls are fast |

---

## STT (Speech-to-Text) – faster-whisper

### Overview

The same Python server that runs Chatterbox TTS also exposes a `POST /stt`
endpoint powered by [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
(`medium.en` model). This enables push-to-talk input in the RPG.

- **Model:** `medium.en` (~1.5 GB, English-only, very accurate)
- **Latency:** ~1-2 seconds for short utterances on CUDA
- **VAD:** Built-in voice activity detection strips silence
- **Supported audio:** `.wav`, `.webm`, `.ogg`, `.mp3`

The STT addon is loaded by `launch_with_stt.py`, which wraps the upstream
`server.py` without modifying it.

### STT API Endpoint

```
POST /stt
Content-Type: multipart/form-data

Form field:  audio  (file upload)
```

**Response:**

```json
{
  "text": "Testing speech to text.",
  "language": "en",
  "duration": 1.92
}
```

### Manual STT Test

```powershell
cd tts-server
.\python_embedded\python.exe launch_with_stt.py

# In another terminal:
curl -X POST http://127.0.0.1:4123/stt -F "audio=@test.wav"
```

---

## Next.js Renderer Integration Guide

Both TTS and STT are exposed to the renderer via `window.localTTS` and
`window.localSTT`. These are only available when the app is running inside the
Electron wrapper (check `window.IN_DESKTOP_ENV`).

### Detecting the Desktop Environment

```typescript
const isDesktop = typeof window !== 'undefined'
  && (window as any).IN_DESKTOP_ENV === true;
```

Always gate TTS/STT features behind this check so the Vercel-hosted web build
still works without errors.

### window.localTTS API (existing)

```typescript
interface LocalTTS {
  isGpuAvailable(): Promise<{ available: boolean; gpuName?: string; vramMB?: number }>;
  isInstalled(): Promise<boolean>;
  start(): Promise<{ baseUrl: string; defaultVoice: string; availableVoices: string[] }>;
  stop(): Promise<{ success: boolean }>;
  getConfig(): Promise<{ baseUrl: string; defaultVoice: string; availableVoices: string[] } | null>;
  getStatus(): Promise<{ running: boolean; ready: boolean; pid?: number }>;
  getVoices(): Promise<{ voices: string[]; error?: string }>;
  speak(
    text: string,
    voice?: string,
    params?: {
      exaggeration?: number;  // 0.25–2.0, default 0.5
      cfgWeight?: number;     // 0.0–1.0, default 0.5
      temperature?: number;   // 0.05–2.0, default 0.7
      speedFactor?: number;   // 0.5–2.0, default 1.0
      seed?: number;          // -1 = random
    }
  ): Promise<{ success: boolean; audioUrl?: string; error?: string }>;
  onReady(callback: (config: unknown) => void): void;
  removeReadyListener(): void;
}
```

### window.localSTT API (new)

```typescript
interface LocalSTT {
  transcribe(
    audioData: ArrayBuffer
  ): Promise<{
    success: boolean;
    text?: string;
    language?: string;
    duration?: number;
    error?: string;
  }>;
  onReady(callback: (config: unknown) => void): void;
  removeReadyListener(): void;
}
```

The `transcribe` method sends raw audio bytes to the Electron main process,
which proxies them to the Python server's `/stt` endpoint. The audio is sent as
a `multipart/form-data` upload internally.

### Push-to-Talk Hook Example

```typescript
// hooks/usePushToTalk.ts
import { useState, useRef, useCallback } from 'react';

export const usePushToTalk = (onResult: (text: string) => void) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
    });

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => chunksRef.current.push(e.data);

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setIsProcessing(true);

      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const arrayBuffer = await blob.arrayBuffer();

      try {
        const localSTT = (window as any).localSTT;
        if (!localSTT) {
          console.warn('localSTT not available (not in Electron)');
          return;
        }
        const result = await localSTT.transcribe(arrayBuffer);
        if (result.success && result.text) {
          onResult(result.text);
        }
      } finally {
        setIsProcessing(false);
      }
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
  }, [onResult]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }, []);

  return { startRecording, stopRecording, isRecording, isProcessing };
};
```

### Push-to-Talk Button Component Example

```tsx
// components/PushToTalkButton.tsx
import { usePushToTalk } from '../hooks/usePushToTalk';
import { Mic, Loader } from 'lucide-react';

export const PushToTalkButton = ({
  onTranscription,
}: {
  onTranscription: (text: string) => void;
}) => {
  const { startRecording, stopRecording, isRecording, isProcessing } =
    usePushToTalk(onTranscription);

  return (
    <button
      onMouseDown={startRecording}
      onMouseUp={stopRecording}
      onMouseLeave={stopRecording}
      disabled={isProcessing}
      className={`p-3 rounded-full transition ${
        isRecording
          ? 'bg-red-600 scale-110 animate-pulse'
          : isProcessing
            ? 'bg-amber-600'
            : 'bg-slate-700 hover:bg-slate-600'
      }`}
      title="Hold to speak"
    >
      {isProcessing ? (
        <Loader className="w-5 h-5 animate-spin" />
      ) : (
        <Mic className="w-5 h-5" />
      )}
    </button>
  );
};
```

### Wiring It Into Your Chat UI

```tsx
// In your RPG chat component:
<PushToTalkButton
  onTranscription={(text) => {
    // Option A: send directly to the AI pipeline
    handleSendMessage(text);

    // Option B: pre-fill the chat input for editing
    // setChatInput(text);
  }}
/>
```

### Important Notes for the Next.js Team

1. **Desktop-only feature.** `window.localSTT` is only available inside the
   Electron wrapper. Gate the mic button behind `window.IN_DESKTOP_ENV`.

2. **Server is shared.** TTS and STT use the same Python server on port 4123.
   The server is started automatically during app launch (during the splash
   screen). No need to start STT separately.

3. **The `onReady` event** on both `localTTS` and `localSTT` fires when the
   Python server finishes loading. Wait for it before enabling the mic button.

4. **Audio format.** `MediaRecorder` with `audio/webm` works great. The server
   accepts `.webm`, `.wav`, `.ogg`, and `.mp3`.

5. **Latency.** Expect ~1-2 seconds for short (1-5 second) utterances on CUDA.
   The `beam_size=1` and VAD filtering are tuned for fast push-to-talk.

6. **ArrayBuffer, not Blob.** The IPC bridge requires `ArrayBuffer`. Convert
   your `Blob` with `await blob.arrayBuffer()` before calling `transcribe()`.

7. **TypeScript types.** Declare the window interfaces in your Next.js app:

   ```typescript
   // types/electron.d.ts
   interface Window {
     IN_DESKTOP_ENV?: boolean;
     localTTS?: {
       isGpuAvailable: () => Promise<any>;
       isInstalled: () => Promise<boolean>;
       start: () => Promise<any>;
       stop: () => Promise<any>;
       getConfig: () => Promise<any>;
       getStatus: () => Promise<{ running: boolean; ready: boolean; pid?: number }>;
       getVoices: () => Promise<{ voices: string[]; error?: string }>;
       speak: (text: string, voice?: string, params?: any) =>
         Promise<{ success: boolean; audioUrl?: string; error?: string }>;
       onReady: (cb: (config: unknown) => void) => void;
       removeReadyListener: () => void;
     };
     localSTT?: {
       transcribe: (audioData: ArrayBuffer) =>
         Promise<{ success: boolean; text?: string; language?: string; duration?: number; error?: string }>;
       onReady: (cb: (config: unknown) => void) => void;
       removeReadyListener: () => void;
     };
   }
   ```

---

## Updating the Server

```powershell
# Pull latest server code and rebuild
.\scripts\setup-tts-server.ps1
```

The setup script does `git pull` on the server repo before copying.
