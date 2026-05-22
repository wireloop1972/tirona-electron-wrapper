import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('startupAPI', {
  // Returns { gpu: { available, gpuName?, vramMB? }, serverInstalled, ttsEnabled }
  getInfo: () => ipcRenderer.invoke('startup:get-info'),

  // Records the player's Voice Synthesis choice and dismisses the menu.
  continue: (ttsEnabled: boolean) =>
    ipcRenderer.invoke('startup:continue', ttsEnabled),
});

console.log('[Startup Menu Preload] Loaded');
