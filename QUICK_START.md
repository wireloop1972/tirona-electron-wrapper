# Chatterbox TTS Quick Start

## 🚀 Fast Track to Running

### Prerequisites
- Node.js 16+
- Chatterbox binary (pre-built in `tts-binaries/chatterbox_server/`)
- GPU recommended but not required

---

## Step 1: Build Electron App

```bash
# Install Node dependencies
npm install

# Build TypeScript
npm run build
```

**Result:** Compiled TypeScript in `dist/`

---

## Step 2: Test It!

### Option A: Run in Electron

```bash
npm run dev
```

Check console for:
```
[TTS Manager] Engine chatterbox: ✓ installed
```

Open DevTools (Ctrl+Shift+I) and test:
```javascript
// Check environment
console.log(window.IN_DESKTOP_ENV); // true
console.log(window.ORPHEUS_TTS_URL); // "http://127.0.0.1:4123"

// Start TTS engine
await window.localTTS.start('chatterbox');

// Test TTS
const result = await window.localTTS.speak('Hello world', 'default');
if (result.success) {
  const audio = new Audio(result.audioUrl);
  audio.play();
}
```

### Option B: TTS Test Mode

```bash
npm run test:tts
```

This opens a dedicated TTS testing page.

---

## Step 3: Package for Distribution

```bash
npm run package:win   # Windows
# or
npm run package:mac   # macOS
```

**Result:** Distributable app in `release/`

---

## Common Issues

### "chatterbox binary not found"
Ensure the binary exists at:
`tts-binaries/chatterbox_server/chatterbox_server.exe`

### "TTS server not starting"
- Check that port 4123 is not in use
- Check console logs for errors
- Try restarting the app

### "Build fails"
```bash
npm run build
# Check for TypeScript errors
```

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `npm run build` | Build TypeScript |
| `npm run dev` | Run in development |
| `npm run package` | Package for distribution |
| `npm run test:tts` | Run TTS test page |

---

## File Locations

- **Chatterbox Binary:** `tts-binaries/chatterbox_server/`
- **TypeScript Output:** `dist/`
- **Packaged App:** `release/`
- **Models (user machine):** `%APPDATA%/Tirona/chatterbox_models` (Windows) or `~/Library/Application Support/Tirona/chatterbox_models` (Mac)

---

## API Usage

### Modern API (Recommended)

```typescript
// Start engine
await window.localTTS.start('chatterbox');

// Speak
const result = await window.localTTS.speak(text, voice);

// Stop engine  
await window.localTTS.stop();
```

### Legacy API (Backwards Compatible)

```typescript
// Legacy orpheus API still works (routes to Chatterbox)
await window.electron.orpheus.start();
const result = await window.electron.orpheus.speak(text, voice);
```

---

## Next Steps

1. ✅ Build Electron app
2. ✅ Test TTS integration
3. 📝 Integrate TTS in your Next.js app
4. 🚀 Package and distribute

---

## Need Help?

- **Distribution:** See `DISTRIBUTION_GUIDE.md`
- **Chatterbox Setup:** See `CHATTERBOX_SETUP.md`
- **Architecture details:** See `IMPLEMENTATION_SUMMARY.md`

---

**Status:** Ready to use! 🎉
