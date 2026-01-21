# Chatterbox TTS Integration - Handover Document

## Overview

This document describes the Chatterbox TTS integration built for the Tirona Electron wrapper, ready for handover to the RPG Next.js app team.

**Status**: ✅ Core TTS pipeline working with GPU acceleration
**Engine**: Chatterbox (OpenAI-compatible API)

---

## Quick Start - Dev vs Prod Builds

### Single Codebase, Two Build Modes

The Electron app uses `APP_ENV` to determine which URL to load:

| Command | APP_ENV | Loads URL |
|---------|---------|-----------|
| `npm run dev` | dev | `http://localhost:3000` |
| `npm run start` | prod | `https://tironabattlemap.vercel.app` |
| `npm run build:electron` | prod | Production installer |

### Development Workflow

```bash
# Terminal 1: Start Next.js dev server
cd tirona-nextjs
npm run dev

# Terminal 2: Start Electron pointing at localhost
cd electronwrapper
npm run dev
```

### Production Build

```bash
# Build installer that loads Vercel URL
npm run build:electron

# Or platform-specific:
npm run package:win
npm run package:mac
```

Both dev and prod builds include **identical Chatterbox TTS setup** - the TTS server always runs locally at `http://127.0.0.1:4123`.

---

## What We Have

### 1. Chatterbox TTS Server (`tts-binaries/chatterbox_server/`)

A bundled TTS server that provides:

- **OpenAI-compatible API** at `http://127.0.0.1:4123`
- **Voice cloning** via custom voice samples
- **GPU acceleration** for NVIDIA GPUs
- **High-quality output** at 24kHz

### 2. Electron Integration (`src/tts-manager.ts`)

TypeScript module that manages the TTS server lifecycle:

```typescript
// Key functions available
interface TTSManager {
  startEngine(engine: 'chatterbox'): Promise<LocalTTSConfig>;
  stopCurrentEngine(): void;
  getCurrentStatus(): Promise<TTSStatus>;
  fetchVoices(engine: TTSEngine): Promise<string[]>;
}
```

---

## API Reference

### Base URL
```
http://127.0.0.1:4123
```

### Endpoints

#### Health Check
```http
GET /health
```
Response:
```json
{
  "status": "healthy",
  "model_loaded": true
}
```

#### List Voices
```http
GET /voices
```
Response:
```json
{
  "voices": [{ "name": "default", ... }],
  "count": 1
}
```

#### Generate Speech (OpenAI-compatible)
```http
POST /v1/audio/speech
Content-Type: application/json

{
  "input": "Text to speak",
  "response_format": "wav"
}
```
Response: Binary WAV audio (24kHz)

---

## Integration Guide for Next.js App

### 1. Check if Running in Electron

```typescript
// utils/environment.ts
export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && 
         (window as any).DESKTOP_ENV?.isElectron === true;
};

export const getTTSUrl = (): string | null => {
  if (!isElectron()) return null;
  return (window as any).ORPHEUS_TTS_URL || 'http://127.0.0.1:4123';
};
```

### 2. Use the Modern localTTS API

```typescript
// services/tts.ts
export async function checkTTSAvailable(): Promise<boolean> {
  if (!isElectron()) return false;
  
  try {
    const status = await (window as any).localTTS?.getStatus();
    return status?.ready === true;
  } catch {
    return false;
  }
}

export async function speak(text: string, voice: string = 'default'): Promise<void> {
  const result = await (window as any).localTTS.speak(text, voice);
  
  if (result.success) {
    const audio = new Audio(result.audioUrl);
    await audio.play();
  } else {
    throw new Error(result.error);
  }
}
```

### 3. Legacy API (Still Works)

```typescript
// For backwards compatibility, the orpheus API routes to Chatterbox
const result = await (window as any).electron.orpheus.speak(text, voice);
```

### 4. Preload Script Exposure (Electron)

The Electron preload script exposes these APIs (identical for dev and prod):

```typescript
// src/preload.ts - Already implemented
contextBridge.exposeInMainWorld('DESKTOP_ENV', {
  isElectron: true,
});

contextBridge.exposeInMainWorld('ORPHEUS_TTS_URL', 'http://127.0.0.1:4123');

contextBridge.exposeInMainWorld('localTTS', {
  getEngines: () => ipcRenderer.invoke('tts:getEngines'),
  start: (engineId) => ipcRenderer.invoke('tts:start', engineId),
  stop: () => ipcRenderer.invoke('tts:stop'),
  getConfig: () => ipcRenderer.invoke('tts:getConfig'),
  getStatus: () => ipcRenderer.invoke('tts:getStatus'),
  speak: (text, voice) => ipcRenderer.invoke('tts:speak', text, voice),
  getVoices: () => ipcRenderer.invoke('tts:getVoices'),
});
```

---

## NPM Scripts Reference

```json
{
  "scripts": {
    // Development - loads localhost:3000
    "dev": "npm run build && cross-env APP_ENV=dev electron .",
    
    // Production run - loads Vercel URL  
    "start": "npm run build && cross-env APP_ENV=prod electron .",
    
    // Build installers
    "package:win": "npm run build && cross-env APP_ENV=prod electron-builder --win",
    "package:mac": "npm run build && cross-env APP_ENV=prod electron-builder --mac",
    
    // TTS testing
    "test:tts": "npm run build && cross-env TTS_TEST=true electron ."
  }
}
```

---

## File Structure for Distribution

```
Tirona/
├── Tirona.exe                    # Main Electron app
├── resources/
│   └── chatterbox/
│       └── chatterbox_server.exe # Bundled TTS server
│
└── [User AppData]/
    └── tirona-electron-wrapper/
        └── chatterbox_models/    # Models cached here
```

---

## Quick Start for Next.js Team

1. **Check environment**:
   ```typescript
   const canUseTTS = isElectron() && await window.localTTS?.getStatus()?.ready;
   ```

2. **Generate speech**:
   ```typescript
   const result = await window.localTTS.speak("Hello adventurer!", "default");
   if (result.success) {
     const audio = new Audio(result.audioUrl);
     await audio.play();
   }
   ```

---

## Contact / Support

- **TTS Server Issues**: Check Electron console logs (`[chatterbox]` prefix)
- **Electron Integration**: See `src/tts-manager.ts`
- **Test Page**: Run `npm run test:tts`

---

*Last Updated: January 2026*
*TTS Engine: Chatterbox*
