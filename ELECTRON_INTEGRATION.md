# Electron Integration Guide for Next.js App

This guide explains how to detect and handle Electron-specific behavior in your Next.js application.

## Detecting Electron Environment

The Electron wrapper exposes a global `window.electron` object that you can use to detect when your app is running inside Electron.

### TypeScript Declaration

Add this to your Next.js app's type declarations (e.g., `types/electron.d.ts`):

```typescript
interface ElectronAPI {
  isElectron: boolean;
  platform: 'darwin' | 'win32' | 'linux';
  onSplashFinished: (callback: () => void) => void;
  removeSplashListener: (callback: () => void) => void;
}

interface Window {
  electron?: ElectronAPI;
}
```

## Usage Examples

### 1. Basic Electron Detection

```typescript
// Check if running in Electron
if (typeof window !== 'undefined' && window.electron?.isElectron) {
  console.log('Running in Electron!');
  console.log('Platform:', window.electron.platform);
}
```

### 2. Prevent Background Music During Splash

**In your Next.js component:**

```typescript
'use client';

import { useEffect, useState } from 'react';

export default function BackgroundMusic() {
  const [splashFinished, setSplashFinished] = useState(false);

  useEffect(() => {
    // Check if running in Electron
    const isElectron = typeof window !== 'undefined' && window.electron?.isElectron;
    
    if (isElectron) {
      // Don't play music until splash is done
      const handleSplashFinished = () => {
        console.log('Splash finished, can start background music');
        setSplashFinished(true);
      };

      // Listen for splash finished event
      window.electron?.onSplashFinished(handleSplashFinished);

      // Cleanup
      return () => {
        window.electron?.removeSplashListener(handleSplashFinished);
      };
    } else {
      // Not in Electron, start music immediately
      setSplashFinished(true);
    }
  }, []);

  // Only render/play music after splash is done (or not in Electron)
  if (!splashFinished) {
    return null;
  }

  return (
    <audio autoPlay loop>
      <source src="/background-music.mp3" type="audio/mpeg" />
    </audio>
  );
}
```

### 3. Conditional Rendering Based on Environment

```typescript
export default function Layout({ children }: { children: React.ReactNode }) {
  const isElectron = typeof window !== 'undefined' && window.electron?.isElectron;

  return (
    <div>
      {isElectron ? (
        <div>Electron-specific UI</div>
      ) : (
        <div>Web-specific UI</div>
      )}
      {children}
    </div>
  );
}
```

### 4. Platform-Specific Styling

```typescript
'use client';

import { useEffect, useState } from 'react';

export default function PlatformSpecific() {
  const [platform, setPlatform] = useState<string>('web');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.electron?.isElectron) {
      setPlatform(window.electron.platform);
    }
  }, []);

  return (
    <div className={`platform-${platform}`}>
      {platform === 'darwin' && <div>macOS-specific content</div>}
      {platform === 'win32' && <div>Windows-specific content</div>}
      {platform === 'web' && <div>Web-specific content</div>}
    </div>
  );
}
```

### 5. Mute Audio Until Splash Finishes (Simple Approach)

```typescript
'use client';

import { useEffect, useRef, useState } from 'react';

export default function AudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [canPlay, setCanPlay] = useState(false);

  useEffect(() => {
    const isElectron = typeof window !== 'undefined' && window.electron?.isElectron;

    if (!isElectron) {
      // Not in Electron, play immediately
      setCanPlay(true);
      return;
    }

    // In Electron, wait for splash to finish
    const handleSplashFinished = () => {
      setCanPlay(true);
      if (audioRef.current) {
        audioRef.current.play().catch(console.error);
      }
    };

    window.electron?.onSplashFinished(handleSplashFinished);

    return () => {
      window.electron?.removeSplashListener(handleSplashFinished);
    };
  }, []);

  return (
    <audio 
      ref={audioRef} 
      autoPlay={canPlay} 
      loop
      muted={!canPlay}
    >
      <source src="/audio.mp3" type="audio/mpeg" />
    </audio>
  );
}
```

## Alternative: Using localStorage

You can also set a flag in localStorage when the app loads in Electron:

```typescript
// In a useEffect on app mount
useEffect(() => {
  if (typeof window !== 'undefined' && window.electron?.isElectron) {
    localStorage.setItem('isElectron', 'true');
  }
}, []);

// Then check it anywhere
const isElectron = localStorage.getItem('isElectron') === 'true';
```

## Best Practices

1. **Always check for `typeof window !== 'undefined'`** before accessing `window.electron` to avoid SSR errors
2. **Use the splash event listener** to coordinate timing-sensitive features like audio
3. **Cleanup listeners** in useEffect return functions to prevent memory leaks
4. **Provide fallbacks** for web browser behavior
5. **Test both environments** (Electron and web browser) to ensure consistent UX

## Debugging

To verify the integration is working:

1. Open Electron app
2. Press F12 or Ctrl+Shift+I to open DevTools
3. In console, type: `window.electron`
4. You should see: `{ isElectron: true, platform: '...', ... }`

## Example: Complete Audio Manager Hook

```typescript
'use client';

import { useEffect, useState } from 'react';

export function useElectronAudio() {
  const [canPlayAudio, setCanPlayAudio] = useState(false);
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    const electronDetected = 
      typeof window !== 'undefined' && 
      window.electron?.isElectron === true;
    
    setIsElectron(electronDetected);

    if (!electronDetected) {
      // Not in Electron, can play immediately
      setCanPlayAudio(true);
      return;
    }

    // In Electron, wait for splash
    const handleSplashFinished = () => {
      setCanPlayAudio(true);
    };

    window.electron?.onSplashFinished(handleSplashFinished);

    return () => {
      window.electron?.removeSplashListener(handleSplashFinished);
    };
  }, []);

  return { canPlayAudio, isElectron };
}

// Usage in component:
// const { canPlayAudio, isElectron } = useElectronAudio();
```

