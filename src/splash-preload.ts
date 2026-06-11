import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('splashAPI', {
  splashFinished: () => ipcRenderer.send('splash-finished'),
});

console.log('[Splash Preload] Loaded');
