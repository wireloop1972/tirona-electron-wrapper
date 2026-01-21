import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for secure communication between renderer and main process
 * Uses contextBridge to safely expose Electron APIs to the renderer
 * 
 * This script is shared between dev and prod builds - no changes needed per environment
 */

// =============================================================================
// Environment Flags
// =============================================================================

// Expose desktop environment flag (for Next.js TTS gateway detection)
contextBridge.exposeInMainWorld('DESKTOP_ENV', {
  isElectron: true,
});

// Also expose IN_DESKTOP_ENV for backwards compatibility
contextBridge.exposeInMainWorld('IN_DESKTOP_ENV', true);

// Expose TTS URL (constant - for legacy compatibility with Next.js battlemap)
// Note: Uses Chatterbox port (4123) but keeps "ORPHEUS_TTS_URL" name for API compatibility
contextBridge.exposeInMainWorld('ORPHEUS_TTS_URL', 'http://127.0.0.1:4123');

// =============================================================================
// Local TTS API - Unified interface for Orpheus/Chatterbox
// =============================================================================

contextBridge.exposeInMainWorld('localTTS', {
  // Get list of installed TTS engines
  // Returns: TTSEngineInfo[] - { id, name, installed }
  getEngines: () => ipcRenderer.invoke('tts:getEngines'),

  // Start a TTS engine (stops any currently running engine first)
  // Returns: LocalTTSConfig - { engine, baseUrl, model, defaultVoice, availableVoices }
  start: (engineId: string) => ipcRenderer.invoke('tts:start', engineId),

  // Stop the currently running TTS engine
  stop: () => ipcRenderer.invoke('tts:stop'),

  // Get current TTS engine config (if running)
  // Returns: LocalTTSConfig | null
  getConfig: () => ipcRenderer.invoke('tts:getConfig'),

  // Get current TTS engine status
  // Returns: { running, ready, engine, pid }
  getStatus: () => ipcRenderer.invoke('tts:getStatus'),

  // Generate speech using the current TTS engine
  // Returns: { success, audioUrl?, error? }
  speak: (text: string, voice: string) => ipcRenderer.invoke('tts:speak', text, voice),

  // Get available voices for the current TTS engine
  // Returns: { voices: string[], error?: string }
  getVoices: () => ipcRenderer.invoke('tts:getVoices'),

  // Listen for TTS ready notification (pushed from main process after engine starts)
  onReady: (callback: (config: unknown) => void) => {
    ipcRenderer.on('tts:ready', (_event, config) => callback(config));
  },

  // Remove ready listener
  removeReadyListener: () => {
    ipcRenderer.removeAllListeners('tts:ready');
  },
});

// Expose Electron APIs to the renderer
contextBridge.exposeInMainWorld('electron', {
  // Indicate that the app is running in Electron
  isElectron: true,
  
  // Platform information
  platform: process.platform,
  
  // Listen for splash screen events
  onSplashFinished: (callback: () => void) => {
    ipcRenderer.on('splash-finished-notify', callback);
  },
  
  // Remove splash event listener
  removeSplashListener: (callback: () => void) => {
    ipcRenderer.removeListener('splash-finished-notify', callback);
  },
  
  // Window control API for frameless window
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    toggleFullscreen: () => ipcRenderer.send('window:toggleFullscreen'),
    isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
    setSize: (width: number, height: number) => 
      ipcRenderer.send('window:setSize', width, height),
    getSize: () => ipcRenderer.invoke('window:getSize'),
  },
  
  // Settings API (placeholder for future implementation)
  openSettings: () => ipcRenderer.send('settings:open'),
  
  // Orpheus TTS API - identical for dev and prod builds
  orpheus: {
    // Get Orpheus server status
    // Returns: { running: boolean, ready: boolean, pid?: number, url: string }
    getStatus: () => ipcRenderer.invoke('orpheus:status'),
    
    // Start Orpheus server (if not already running)
    start: () => ipcRenderer.invoke('orpheus:start'),
    
    // Stop Orpheus server
    stop: () => ipcRenderer.invoke('orpheus:stop'),
    
    // Get available voices (fetches from TTS server via main process)
    // Returns: { status: string, voices: string[] }
    getVoices: () => ipcRenderer.invoke('orpheus:voices'),
    
    // Generate speech (fetches from TTS server via main process)
    // Returns: ArrayBuffer of audio data
    speak: (text: string, voice: string) => ipcRenderer.invoke('orpheus:speak', text, voice),
    
    // 🔔 Listen for TTS ready notification (pushed from main process)
    onReady: (callback: (voices: string[]) => void) => {
      ipcRenderer.on('orpheus:ready', (_event, voices) => callback(voices));
    },
    
    // Remove ready listener
    removeReadyListener: () => {
      ipcRenderer.removeAllListeners('orpheus:ready');
    },
  },
});

// =============================================================================
// Logging
// =============================================================================

// Log that preload script has loaded (for debugging)
console.log('[Preload] Script loaded successfully');
console.log('[Preload] Desktop environment detected');
console.log('[Preload] Available APIs: window.electron, window.localTTS');
console.log('[Preload] Use window.localTTS.getEngines() to see installed TTS engines');
console.log('[Preload] Use window.localTTS.start("chatterbox") to start the TTS engine');

