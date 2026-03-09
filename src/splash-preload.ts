import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('splashAPI', {
  splashFinished: () => ipcRenderer.send('splash-finished'),

  onTTSNeeded: (cb: () => void) => {
    ipcRenderer.on('splash:tts-needed', cb);
  },

  onTTSReady: (cb: () => void) => {
    ipcRenderer.on('splash:tts-ready', cb);
  },
});

console.log('[Splash Preload] Loaded');
