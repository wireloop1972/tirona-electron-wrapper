# Tirona Header Components

Custom header components for the Tirona desktop app frameless window.

## Overview

These components provide a styled header that matches the Tirona game aesthetic:
- Dark gradient background with blur effect
- Gold (#f0c878) typography and accents
- Custom window controls (minimize, maximize, close)
- Navigation menu with icons
- Draggable title region for window movement

## Files

| File | Description |
|------|-------------|
| `TironaHeader.tsx` | Pure inline styles version (no dependencies) |
| `TironaHeader.tailwind.tsx` | Tailwind CSS version (requires lucide-react) |

## Integration

### 1. Copy the component to your Next.js project

```bash
# Copy to your Next.js components folder
cp components/TironaHeader.tsx ../tirona-nextjs/components/
```

### 2. Add to your root layout

```tsx
// app/layout.tsx
import { TironaHeader } from '@/components/TironaHeader';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <TironaHeader 
          currentPage="adventure"
          onNavigate={(page) => router.push(`/${page}`)}
          userName="Player Name"
          userAvatar="/avatar.png" // optional
        />
        <main className="pt-14"> {/* Add padding-top for fixed header */}
          {children}
        </main>
      </body>
    </html>
  );
}
```

### 3. For Tailwind version, install dependencies

```bash
npm install lucide-react
```

Add custom colors to `tailwind.config.js`:

```js
module.exports = {
  theme: {
    extend: {
      colors: {
        tirona: {
          gold: '#f0c878',
          'gold-light': '#d4a84b',
          dark: '#1a130e',
          'dark-light': '#2d1f14',
        },
      },
    },
  },
};
```

### 4. Optional: Add Cinzel font for title

```html
<!-- In your HTML head or Next.js layout -->
<link 
  href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&display=swap" 
  rel="stylesheet"
/>
```

Then update the title span class:
```tsx
<span className="font-['Cinzel'] ...">Tirona</span>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `currentPage` | `string` | `'adventure'` | Currently active navigation item |
| `onNavigate` | `(page: string) => void` | - | Callback when nav item is clicked |
| `userName` | `string` | `'Player'` | User display name |
| `userAvatar` | `string` | - | URL to user avatar image |

## Electron Window Configuration

The header is designed to work with a frameless Electron window. The main.ts configuration:

```ts
mainWindow = new BrowserWindow({
  frame: false,           // No OS title bar
  titleBarStyle: 'hidden', // macOS fallback
  // ...
});
```

## Window Drag Region

- The **logo and title area** (left side) is draggable (`-webkit-app-region: drag`)
- **Navigation buttons** and **window controls** are NOT draggable (`-webkit-app-region: no-drag`)

## API Reference

The header uses these Electron IPC APIs (exposed via preload.ts):

```ts
window.electron.window.minimize()    // Minimize window
window.electron.window.maximize()    // Toggle maximize
window.electron.window.close()       // Close window
window.electron.window.isMaximized() // Returns Promise<boolean>
window.electron.openSettings()       // Open settings (placeholder)
```

## Styling Specifications

Based on the screenshot reference:

- **Height**: 56px
- **Background**: Linear gradient from `#2d1f14` (top) to `#1a130e` (bottom) at 95% opacity
- **Backdrop blur**: 12px
- **Border bottom**: 1px `#f0c878` at 20% opacity
- **Gold color**: `#f0c878` (primary), `#d4a84b` (secondary)
- **Title font**: Serif (Cinzel preferred), tracking 0.05em
- **REBIRTH text**: 11px, uppercase, tracking 0.2em
- **Nav buttons**: Rounded pill style, 20px border-radius
