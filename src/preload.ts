import { contextBridge, ipcRenderer } from 'electron';

// =============================================================================
// Environment Flags
// =============================================================================

contextBridge.exposeInMainWorld('DESKTOP_ENV', { isElectron: true });
contextBridge.exposeInMainWorld('IN_DESKTOP_ENV', true);

// =============================================================================
// Local TTS API – Chatterbox Turbo (CUDA-only)
// =============================================================================

contextBridge.exposeInMainWorld('localTTS', {
  isGpuAvailable: () => ipcRenderer.invoke('tts:gpuAvailable'),

  isInstalled: () => ipcRenderer.invoke('tts:isInstalled'),

  start: () => ipcRenderer.invoke('tts:start'),

  stop: () => ipcRenderer.invoke('tts:stop'),

  getConfig: () => ipcRenderer.invoke('tts:getConfig'),

  getStatus: () => ipcRenderer.invoke('tts:getStatus'),

  speak: (
    text: string,
    voice?: string,
    params?: {
      exaggeration?: number;
      cfgWeight?: number;
      temperature?: number;
      speedFactor?: number;
      seed?: number;
    }
  ) => ipcRenderer.invoke('tts:speak', text, voice ?? 'default', params),

  getVoices: () => ipcRenderer.invoke('tts:getVoices'),

  onReady: (callback: (config: unknown) => void) => {
    ipcRenderer.on('tts:ready', (_event, config) => callback(config));
  },

  removeReadyListener: () => {
    ipcRenderer.removeAllListeners('tts:ready');
  },
});

// =============================================================================
// Electron API (window controls, splash, settings)
// =============================================================================

contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  platform: process.platform,

  onSplashFinished: (callback: () => void) => {
    ipcRenderer.on('splash-finished-notify', callback);
  },
  removeSplashListener: (callback: () => void) => {
    ipcRenderer.removeListener('splash-finished-notify', callback);
  },

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

  openSettings: () => ipcRenderer.send('settings:open'),
});

// =============================================================================
// Logging
// =============================================================================

console.log('[Preload] Loaded – APIs: window.localTTS, window.electron');
