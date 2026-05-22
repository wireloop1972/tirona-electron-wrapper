import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('splashAPI', {
  splashFinished: () => ipcRenderer.send('splash-finished'),

  onTTSNeeded: (cb: () => void) => {
    ipcRenderer.on('splash:tts-needed', cb);
  },

  onTTSReady: (cb: () => void) => {
    ipcRenderer.on('splash:tts-ready', cb);
  },

  onNarratorAudio: (cb: (audioUrl: string) => void) => {
    ipcRenderer.on('splash:narrator-audio', (_e, audioUrl: string) =>
      cb(audioUrl)
    );
  },
});

console.log('[Splash Preload] Loaded');
