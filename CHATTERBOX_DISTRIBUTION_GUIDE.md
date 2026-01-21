# Chatterbox TTS Distribution Guide

## Summary of Work Completed

### 1. Chatterbox Integration with Electron

We successfully integrated Chatterbox TTS as an alternative to Orpheus TTS in the Electron wrapper. The key changes were:

#### Electron Side (`electronwrapper/`)

- **`src/tts-manager.ts`**: Added external server detection so Electron can detect a manually-running Chatterbox server (not just engines it spawns itself). Updated `fetchVoices()` to use Chatterbox's `/voices` endpoint instead of Orpheus's `/v1/audio/voices`.

- **`src/main.ts`**: Updated legacy IPC handlers (`orpheus:voices`, `orpheus:speak`) to use the unified TTS detection system, allowing them to route requests to whichever TTS server is running (Orpheus on port 5005, or Chatterbox on port 4123).

#### Battlemap Side (`Battlemap/lib/tts/`)

- **`orpheus-service.ts`**: Changed `isOrpheusAvailable()` to use `/health` endpoint instead of `/v1/audio/voices` for availability checking. This works for both Orpheus and Chatterbox.

#### Chatterbox API (`chatterbox-tts-api/`)

- **`app/api/endpoints/speech.py`**: Fixed audio saving to use `scipy.io.wavfile` instead of `torchaudio.save()` to avoid FFmpeg/torchcodec dependency issues with PyTorch nightly builds.

- **Dependencies**: Installed CUDA-enabled PyTorch nightly (`cu128`) for RTX 5080 GPU support.

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Electron App (Tirona)                        │
│  ┌─────────────────┐     ┌─────────────────────────────────┐   │
│  │   Main Process   │     │        Renderer (Next.js)       │   │
│  │  - tts-manager   │     │  - Settings UI                  │   │
│  │  - IPC handlers  │────▶│  - TTS playback                 │   │
│  │  - Engine detect │     │  - Voice selection              │   │
│  └────────┬────────┘     └─────────────────────────────────┘   │
│           │                                                      │
└───────────┼──────────────────────────────────────────────────────┘
            │ HTTP (localhost)
            ▼
┌─────────────────────────────────────────────────────────────────┐
│              Chatterbox TTS Server (Port 4123)                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  FastAPI Application                                      │   │
│  │  - /health           → Health check                       │   │
│  │  - /v1/audio/speech  → Generate audio (OpenAI compatible) │   │
│  │  - /voices           → List custom voices                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Chatterbox Model (GPU)                                   │   │
│  │  - ~3GB VRAM usage                                        │   │
│  │  - CUDA acceleration                                      │   │
│  │  - Voice cloning support                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files & Components for Distribution

### Core Components Needed

| Component | Size (approx) | Description |
|-----------|---------------|-------------|
| `chatterbox-tts-api/` | ~50MB | Python FastAPI server code |
| Python venv with deps | ~5GB | PyTorch CUDA, transformers, etc. |
| Voice sample(s) | ~1-10MB | Default voice for cloning |
| **Total** | **~5-6GB** | Full TTS addon |

### GPU Requirements

- NVIDIA GPU with CUDA support (tested on RTX 5080)
- ~3GB VRAM for model inference
- CUDA 12.x drivers

---

## Distribution Options

### Option A: Steam DLC

**Pros:**
- Integrated with Steam's download/update system
- Users can opt-in via purchase or free DLC
- Steam handles large file distribution efficiently
- Version management through Steam depots

**Cons:**
- Requires Steam partnership/approval for DLC
- More complex setup for first-time distribution
- Users need Steam running

**Implementation Steps:**

1. **Create a Steam Depot** for the TTS addon containing:
   - Pre-built Python environment (portable Python + venv)
   - Chatterbox API code
   - Default voice sample(s)

2. **Modify Electron App** to:
   - Check for DLC installation via Steam API
   - Launch Chatterbox server from DLC install path
   - Show "Install TTS DLC" button if not present

3. **Steam Depot Structure:**
   ```
   dlc_tts/
   ├── python/              # Embedded Python 3.11
   ├── chatterbox-api/      # FastAPI server
   ├── models/              # Pre-downloaded if needed
   ├── voices/              # Default voice samples
   └── start_tts.bat        # Launcher script
   ```

---

### Option B: Standalone Addon Installer (Recommended for Initial Release)

**Pros:**
- Works with or without Steam
- Simpler to implement and test
- Users can install independently
- More control over installation process

**Cons:**
- Separate download/update mechanism needed
- Users must manually download

**Implementation Steps:**

1. **Create Installer Package** using NSIS, Inno Setup, or similar:
   ```
   TironaVoicePack-Setup.exe
   ├── Installs to: %LOCALAPPDATA%/Tirona/voice-pack/
   ├── Creates: start_chatterbox.bat
   └── Size: ~5-6GB compressed
   ```

2. **Installer Contents:**
   ```
   voice-pack/
   ├── python-embed/           # Python 3.11 embeddable (no install needed)
   │   ├── python.exe
   │   ├── python311.dll
   │   └── Lib/site-packages/  # All dependencies pre-installed
   ├── chatterbox-api/         # API server code
   │   ├── app/
   │   ├── main.py
   │   └── voice-sample.mp3
   ├── start.bat               # Simple launcher
   └── uninstall.exe
   ```

3. **Modify Electron App** to:
   - Check for addon at known install paths
   - Show "Download Voice Pack" button linking to download page
   - Auto-detect and launch if present

---

### Option C: PyInstaller Executable (Simplest but Largest)

**Pros:**
- Single .exe file (with supporting DLLs)
- No Python installation needed
- Easiest for users

**Cons:**
- Very large file size (~8-10GB)
- PyInstaller can have issues with complex ML dependencies
- We already encountered issues with the bundled exe not loading models correctly

**Current Status:**
- We attempted this earlier but the bundled `chatterbox_server.exe` had model loading issues
- Not recommended until PyInstaller bundling issues are resolved

---

## Recommended Distribution Strategy

### Phase 1: Manual/Power User Release

1. Provide a ZIP download containing:
   - `python-embed/` - Portable Python with all dependencies
   - `chatterbox-api/` - Server code
   - `start-chatterbox.bat` - One-click launcher
   - `README.txt` - Simple instructions

2. User downloads, extracts, runs `start-chatterbox.bat`

3. Electron app auto-detects the running server

### Phase 2: Installer Release

1. Package Phase 1 contents into NSIS/Inno Setup installer
2. Add Start Menu shortcuts
3. Add "Launch with Tirona" option
4. Register uninstaller

### Phase 3: Steam DLC (If Applicable)

1. Convert installer to Steam depot
2. Integrate Steam API for DLC detection
3. Auto-launch from Steam install path

---

## Packaging the Voice Pack

### Creating the Portable Python Environment

```powershell
# 1. Download Python embeddable package
# https://www.python.org/ftp/python/3.11.x/python-3.11.x-embed-amd64.zip

# 2. Extract and enable pip
# Edit python311._pth, uncomment "import site"

# 3. Install pip
python.exe get-pip.py

# 4. Install dependencies
python.exe -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
python.exe -m pip install fastapi uvicorn transformers scipy numpy pydub

# 5. Copy chatterbox-api code
```

### Launcher Script (start-chatterbox.bat)

```batch
@echo off
cd /d "%~dp0"
echo Starting Tirona Voice Pack...
echo.
echo This window must stay open while using voice features.
echo.
python-embed\python.exe chatterbox-api\main.py
pause
```

---

## Electron App Changes for Addon Detection

The Electron app should:

1. **Check for addon on startup:**
   ```
   Paths to check:
   - %LOCALAPPDATA%/Tirona/voice-pack/
   - {app}/resources/voice-pack/
   - Steam DLC path (if applicable)
   ```

2. **Auto-launch option:**
   - Add setting: "Auto-start voice server"
   - Launch `start-chatterbox.bat` or equivalent on app start

3. **UI indicators:**
   - Show "Voice Pack: Installed ✓" or "Voice Pack: Not Installed"
   - Provide download link if not installed

---

## File Size Optimization

To reduce the ~5-6GB package size:

1. **Use CPU-only PyTorch** (~2GB smaller, but slower inference)
2. **Strip unnecessary CUDA libraries** (keep only sm_89 for RTX 40/50 series)
3. **Compress with 7z LZMA2** (typically 40-50% compression)
4. **Split download** (base + model files separately)

---

## Testing Checklist Before Distribution

- [ ] Fresh Windows install test (no Python pre-installed)
- [ ] Launch from non-admin account
- [ ] Path with spaces works
- [ ] Anti-virus doesn't flag
- [ ] GPU detection works on various NVIDIA cards
- [ ] Fallback to CPU if no GPU
- [ ] Memory usage acceptable (~3GB VRAM, ~2GB RAM)
- [ ] Clean shutdown when Electron closes

---

## Next Steps

1. **Voice Samples**: Test different voice samples for quality and compatibility
2. **Portable Python**: Create the embeddable Python package with all dependencies
3. **Installer**: Choose and set up installer tool (Inno Setup recommended)
4. **Download Hosting**: Set up hosting for the large addon file (GitHub Releases, own server, or Steam)
5. **Electron Integration**: Add addon detection and download prompts to main app

---

## Summary

**What Works Now:**
- Chatterbox running manually on GPU (CUDA)
- Electron app detects and uses the running server
- TTS generation successful via Settings → Test Voice

**What's Needed for Distribution:**
- Package Python + dependencies into portable format
- Create installer or ZIP package
- Add addon detection to Electron app
- Set up download hosting

The recommended approach is to start with a simple ZIP download for testing, then graduate to an installer, and finally Steam DLC if warranted by user demand.
