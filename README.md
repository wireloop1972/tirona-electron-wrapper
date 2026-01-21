# Tirona Electron Wrapper

A secure, lightweight Electron wrapper for the Tirona Next.js application with 
Clerk authentication and Supabase integration.

## Features

- 🎬 Video splash screen on startup with skip functionality
- 🔒 Secure configuration with context isolation
- 🌐 Loads from localhost:3000 in development
- 🚀 Production: https://tironabattlemap.vercel.app
- 🔐 Clerk OAuth authentication fully working (Google, etc.)
- 🪟 Cross-platform support (Windows & macOS)
- 📦 Easy packaging with electron-builder
- 🔄 **Auto-update via GitHub Releases (ACTIVE!)**
- ⚡ Web app updates automatically (no wrapper update needed)
- 🎨 Clean UI with no default menus
- 🔊 **Local Chatterbox TTS microservice**
- 🎙️ High-quality AI voice synthesis
- 🚀 Low-latency audio generation (no cloud calls)

## Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- Your Next.js application running on `localhost:3000` for development
- **For TTS (bundled):**
  - GPU recommended but not required
  - ~2GB disk space for Chatterbox binary

## Installation

1. Install dependencies:

```bash
npm install
```

2. Update the production URL in `config.json`:

```json
{
  "production": {
    "url": "https://your-actual-app.vercel.app"
  }
}
```

## Development

### Running in Development Mode

1. Start your Next.js application on `localhost:3000`:

```bash
cd ../your-nextjs-app
npm run dev
# or
vercel dev
```

2. In a separate terminal, start the Electron wrapper:

```bash
npm run dev
```

The Electron app will open and load your Next.js app from localhost.

## Building for Production

### Compile TypeScript

```bash
npm run build
```

### Package for All Platforms

```bash
npm run package
```

This will create installers for both Windows and macOS in the `release` folder.

### Platform-Specific Builds

**Windows only:**
```bash
npm run package:win
```

**macOS only:**
```bash
npm run package:mac
```

## Project Structure

```
electronwrapper/
├── src/
│   ├── main.ts          # Main Electron process
│   ├── preload.ts       # Preload script for secure IPC
│   ├── tts-manager.ts   # TTS engine manager (Chatterbox)
│   ├── splash-preload.ts # Preload script for splash window
│   └── splash.html      # Video splash screen
├── tts-binaries/        # TTS server binaries (not in git)
│   └── chatterbox_server/
├── dist/                # Compiled JavaScript (generated)
├── release/             # Built installers (generated)
├── assets/              # App icons and video
│   ├── TironaFading.mp4 # Splash screen video
│   └── README.md        # Icon guidelines
├── config.json          # Environment URLs configuration
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
└── electron-builder.yml # Build configuration
```

## Configuration

### Environment URLs

Edit `config.json` to configure different URLs:

```json
{
  "development": {
    "url": "http://localhost:3000"
  },
  "production": {
    "url": "https://your-production-app.vercel.app"
  }
}
```

### Splash Video

The splash screen plays `assets/TironaFading.mp4` on startup:
- Press **ESC** to skip the video
- Click the **Skip** button to skip the video
- Video plays with sound in fullscreen
- If video file is missing, app proceeds directly to main window

### App Icons

The `assets` folder should contain your application icons:

- **Windows**: `icon.ico` (256x256 recommended)
- **macOS**: `icon.icns` (1024x1024 recommended)

You can use tools like:
- [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder)
- [icon-gen](https://www.npmjs.com/package/icon-gen)
- Online converters

## Clerk Authentication

The Electron wrapper is configured to handle Clerk OAuth flows properly:

- Deep linking is set up with the `tirona://` protocol
- External authentication windows are handled automatically
- OAuth redirects work seamlessly with Clerk's web-based flow

No additional configuration is needed if Clerk is already set up in your 
Next.js application.

## Splash Screen

The app displays a video splash screen (`TironaFading.mp4`) on startup with:

- **ESC key** - Skip the video and go directly to the app
- **Skip button** - Click the "Skip" text in the bottom-right corner
- **Auto-proceed** - Automatically proceeds to the app when video ends
- **Graceful fallback** - If video is missing, skips directly to the app

To replace the splash video, simply replace `assets/TironaFading.mp4` with your 
own video file (keep the same filename).

## Security Features

- ✅ Context isolation enabled
- ✅ Node integration disabled (secure for remote content)
- ✅ Web security enabled
- ✅ External links open in default browser
- ✅ Preload script for controlled IPC communication
- ✅ Default menus removed (custom menu support planned)

## Auto-Updates ✅

**Implemented!** The app now includes automatic updates via GitHub Releases.

### How It Works

**Electron Wrapper Updates:**
- App checks GitHub Releases every 4 hours
- Downloads updates silently in background
- Notifies user when ready
- Installs on next restart

**Web App Updates (Automatic):**
- Next.js app on Vercel updates instantly
- No Electron update needed
- Users always see latest web content

### Distribution

See `RELEASE.md` for complete instructions on:
- Creating GitHub releases
- Version management
- Update testing
- Publishing workflow

**Quick Start:**
1. Create GitHub repository
2. Set `GH_TOKEN` environment variable
3. Run `npm run package:win`
4. Publish to GitHub Releases

## Troubleshooting

### App won't start

- Ensure your Next.js app is running on `localhost:3000`
- Check the console for error messages
- Verify `config.json` has valid URLs

### Build errors

- Run `npm run build` first to compile TypeScript
- Ensure all dependencies are installed
- Check that icon files exist in the `assets` folder

### Clerk authentication issues

- Verify Clerk is properly configured in your Next.js app
- Check that redirect URIs include the Electron protocol (`tirona://`)
- Review browser console in DevTools (Cmd+Option+I / Ctrl+Shift+I)

## Development Tips

- Use `npm run lint` to check for code style issues
- DevTools automatically open in development mode
- Check the Electron console for debug logs

## Chatterbox TTS Integration 🔊

The Electron wrapper includes a local Chatterbox TTS (Text-to-Speech) microservice that provides high-quality AI voice synthesis without cloud dependencies.

### Features

- **Local Processing:** All TTS generation happens on the user's machine
- **Voice Cloning:** Custom voice support via voice samples
- **GPU Acceleration:** Automatic CUDA support if available
- **Low Latency:** Fast generation after model warmup

### Quick Start

The TTS engine is bundled with the app and starts automatically when needed.

**For Next.js Developers:** See `CHATTERBOX_DISTRIBUTION_GUIDE.md` for integration details.

### API Endpoints

The TTS server runs on `http://127.0.0.1:4123`:

- `GET /health` - Check server status
- `GET /voices` - List available voices
- `POST /v1/audio/speech` - Generate speech from text

### Example Usage (Next.js)

```typescript
// Detect Electron environment
if (window.IN_DESKTOP_ENV) {
  // Generate TTS via the localTTS API
  const result = await window.localTTS.speak(
    "The goblin snarls and raises its spear.",
    "default"
  );
  
  if (result.success) {
    const audio = new Audio(result.audioUrl);
    await audio.play();
  }
}
```

### Legacy API Compatibility

For backwards compatibility with existing code, the `window.electron.orpheus` API is still available and routes to Chatterbox internally:

```typescript
// Legacy API (still works, routes to Chatterbox)
const result = await window.electron.orpheus.speak(text, voice);
```

## License

MIT

## Support

For issues related to:
- **Electron wrapper**: Check this repository
- **Next.js app**: Refer to your Next.js application documentation
- **Clerk authentication**: Visit [Clerk docs](https://clerk.com/docs)
- **Supabase**: Visit [Supabase docs](https://supabase.com/docs)
