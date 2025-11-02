import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for secure communication between renderer and main process
 * Uses contextBridge to safely expose Electron APIs to the renderer
 */

// Expose Electron detection and control APIs
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
});

// Log that preload script has loaded (for debugging)
console.log('Preload script loaded successfully');

