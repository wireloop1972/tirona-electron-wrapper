import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for splash screen window
 * Exposes minimal API to communicate splash completion
 */

contextBridge.exposeInMainWorld('electron', {
  // Notify main process that splash is finished
  splashFinished: () => {
    ipcRenderer.send('splash-finished');
  },
});

console.log('Splash preload script loaded');


