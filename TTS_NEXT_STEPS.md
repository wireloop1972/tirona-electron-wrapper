# Chatterbox TTS - Next Steps & Current Status

## 🎯 WHERE WE ARE NOW

### ✅ What's Working
1. **Chatterbox Integration**: TTS server bundled and functional
2. **Electron Integration**: Server starts/stops with Electron automatically
3. **Build System**: PyInstaller executable included in tts-binaries/
4. **Test Infrastructure**: Test page functional via `npm run test:tts`
5. **API Compatibility**: Legacy orpheus API preserved for backwards compatibility

### ✅ Current Status
**Chatterbox TTS fully operational**

- Server runs at `http://127.0.0.1:4123`
- OpenAI-compatible API
- Voice cloning via custom samples
- GPU acceleration when available

## 📋 DEPLOYMENT NEXT STEPS

### Step 1: GitHub Distribution (Current)
```bash
# Build and package
npm run build
npm run package:win

# Creates release/win-unpacked/ with:
# - Tirona.exe
# - resources/chatterbox/chatterbox_server.exe
```

### Step 2: Test on Clean Machine
1. Copy `release/win-unpacked/` to a test machine
2. Run `Tirona.exe`
3. Verify TTS starts and works

### Step 3: Create GitHub Release
```bash
# Set GitHub token
$env:GH_TOKEN="your_token"

# Package with publishing
npm run package:win
```

### Step 4: Steam Distribution (Future)
See `DISTRIBUTION_GUIDE.md` for Steam requirements:
- Steam Developer Account ($100)
- Code signing certificate (recommended)
- Steam depot configuration

## 🔧 CONFIGURATION

### TTS Port
- Default: 4123
- Configured in `src/tts-manager.ts`

### Voice Samples
- Location: `tts-binaries/chatterbox_server/voice-sample.wav`
- Custom voices can be uploaded via the /voices API

### Models
- Downloaded on first use
- Stored in: `%APPDATA%/Tirona/chatterbox_models`

## 📚 FILE OVERVIEW

| File | Description |
|------|-------------|
| `src/tts-manager.ts` | TTS engine lifecycle management |
| `src/main.ts` | IPC handlers for TTS API |
| `src/preload.ts` | Exposes TTS API to renderer |
| `types/electron.d.ts` | TypeScript definitions |
| `tts-binaries/chatterbox_server/` | Bundled binary |

## 🎯 SUCCESS METRICS

### Minimum Viable ✅
- [x] Server starts automatically
- [x] Health checks pass  
- [x] TTS endpoint responds
- [x] Returns WAV audio
- [x] Electron integration works

### Full Production
- [x] Chatterbox loads models
- [x] Voice generation works
- [x] Audio quality good
- [x] Performance acceptable
- [ ] Code signing (recommended for distribution)
- [ ] Steam integration (optional)

## 💡 TESTING

### Quick Test
```bash
npm run test:tts
```

### Manual Test
```javascript
// In Electron DevTools console:
await window.localTTS.start('chatterbox');
const result = await window.localTTS.speak('Hello world', 'default');
console.log(result);
```

### Health Check
```bash
curl http://127.0.0.1:4123/health
```

## 📞 TROUBLESHOOTING

### TTS not starting
1. Check Electron console for `[TTS Manager]` logs
2. Verify binary exists at `tts-binaries/chatterbox_server/`
3. Check port 4123 is not in use

### Audio not playing
1. Check browser audio permissions
2. Verify `result.success` is true
3. Check console for errors

### Performance issues
1. GPU recommended for best performance
2. First request is slower (model loading)
3. Subsequent requests should be faster
