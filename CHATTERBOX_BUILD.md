# Chatterbox TTS Server Build Guide

This guide explains how to build the Chatterbox TTS server as a standalone Windows executable for bundling with the Electron wrapper.

## Overview

- **Source Repository**: https://github.com/travisvn/chatterbox-tts-api
- **Official Docs**: https://chatterboxtts.com/docs
- **Output Path**: `tts-binaries/chatterbox_server/chatterbox_server.exe`
- **Port**: `4123`
- **Required Endpoints**:
  - `GET /health` - Liveness probe (returns 200 when ready)
  - `POST /v1/audio/speech` - OpenAI-compatible TTS endpoint

## Prerequisites

- Python 3.10+ with pip
- PyInstaller (`pip install pyinstaller`)
- CUDA toolkit (for GPU acceleration)
- Git

## Build Steps

### 1. Clone the Repository

```bash
git clone https://github.com/travisvn/chatterbox-tts-api
cd chatterbox-tts-api
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
pip install pyinstaller
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with these settings:

```env
CHBTTS_API_PORT=4123
CHBTTS_API_HOST=127.0.0.1
# Add model paths as needed
```

### 4. Create Entry Script

Create `start_chatterbox_api.py` in the repo root:

```python
#!/usr/bin/env python3
"""
Chatterbox TTS API Server Entry Point
Designed for PyInstaller bundling with Electron wrapper.
"""

import os
import sys
import argparse

def main():
    parser = argparse.ArgumentParser(description='Chatterbox TTS Server')
    parser.add_argument('--port', type=int, default=4123, help='Port to listen on')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Host to bind to')
    args = parser.parse_args()

    # Set environment variables before importing uvicorn
    os.environ['CHBTTS_API_PORT'] = str(args.port)
    os.environ['CHBTTS_API_HOST'] = args.host

    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        log_level="info",
    )

if __name__ == "__main__":
    main()
```

### 5. Create PyInstaller Spec (Optional)

For more control, create `chatterbox_server.spec`:

```python
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['start_chatterbox_api.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('app', 'app'),
        ('.env', '.'),
    ],
    hiddenimports=[
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'fastapi',
        'pydantic',
        'starlette',
        # Add Chatterbox-specific imports as needed
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='chatterbox_server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
```

### 6. Build the Executable

**Option A: Simple build**

```bash
pyinstaller --onefile --name chatterbox_server start_chatterbox_api.py
```

**Option B: Using spec file**

```bash
pyinstaller chatterbox_server.spec --clean -y
```

### 7. Copy to Electron Wrapper

```bash
# From the chatterbox-tts-api directory
mkdir -p ../electronwrapper/tts-binaries/chatterbox_server
cp dist/chatterbox_server.exe ../electronwrapper/tts-binaries/chatterbox_server/
```

Or use the provided build script (see below).

## Automated Build Script

Use `scripts/build-chatterbox.ps1` from the Electron wrapper:

```powershell
.\scripts\build-chatterbox.ps1
```

## Verifying the Build

Test the executable before bundling:

```bash
# Start the server
.\tts-binaries\chatterbox_server\chatterbox_server.exe --port 4123

# In another terminal, test health endpoint
curl http://127.0.0.1:4123/health

# Test TTS endpoint
curl -X POST http://127.0.0.1:4123/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model": "tts-1", "input": "Hello world", "voice": "thomas", "response_format": "wav"}' \
  --output test.wav
```

## Expected API Behavior

### Health Check

```
GET /health
Response: 200 OK
```

### Text-to-Speech (OpenAI Compatible)

```
POST /v1/audio/speech
Content-Type: application/json

{
  "model": "tts-1",           // or "tts-1-hd"
  "input": "Text to speak",
  "voice": "thomas",          // voice name
  "response_format": "wav"    // wav, mp3, etc.
}

Response: audio/wav binary data
```

## Troubleshooting

### Missing Dependencies

If the exe fails to start, you may need to include additional hidden imports in the spec file. Run the Python version first to identify missing modules:

```bash
python start_chatterbox_api.py --port 4123
```

### CUDA Issues

Ensure CUDA DLLs are accessible. You may need to copy them to the output directory or include them in the spec file's `binaries` list.

### Port Already in Use

The Electron TTS manager will kill any existing process on port 4123 before starting Chatterbox. If you see port conflicts during testing, manually kill the process:

```powershell
# Find process using port 4123
netstat -ano | findstr :4123

# Kill by PID
taskkill /F /PID <pid>
```

## Integration with Electron

Once built, the Electron wrapper will:

1. Detect the binary at `tts-binaries/chatterbox_server/chatterbox_server.exe`
2. Report it as installed via `window.localTTS.getEngines()`
3. Launch it when user calls `window.localTTS.start('chatterbox')`
4. Wait for `/health` to return 200
5. Provide the config to the renderer:

```typescript
{
  engine: 'chatterbox',
  baseUrl: 'http://127.0.0.1:4123/v1',
  model: 'tts-1',
  defaultVoice: 'thomas',
  availableVoices: ['thomas', ...]
}
```
