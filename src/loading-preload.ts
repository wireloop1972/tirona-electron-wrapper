import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for the loading/sync screen
 * Exposes sync-related IPC APIs to the renderer
 */

// Status callback type
type StatusCallback = (status: string, message?: string) => void;
type ProgressCallback = (data: {
  downloadedBytes: number;
  totalBytes: number;
  currentAsset?: string;
  currentAssetBytes?: number;
  currentAssetTotal?: number;
  completed: number;
  remaining: number;
  failed: number;
}) => void;

// Expose sync API to renderer
contextBridge.exposeInMainWorld('syncAPI', {
  // Signal that loading page is ready
  ready: () => {
    ipcRenderer.send('loading:ready');
  },

  // Listen for status updates
  onStatus: (callback: StatusCallback) => {
    ipcRenderer.on('sync:status', (_event, status: string, message?: string) => {
      callback(status, message);
    });
  },

  // Listen for progress updates
  onProgress: (callback: ProgressCallback) => {
    ipcRenderer.on('sync:progress', (_event, data) => {
      callback(data);
    });
  },

  // Remove all listeners (cleanup)
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('sync:status');
    ipcRenderer.removeAllListeners('sync:progress');
  }
});

console.log('[Loading Preload] Script loaded');
