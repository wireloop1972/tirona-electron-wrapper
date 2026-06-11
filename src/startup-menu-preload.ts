import { contextBridge, ipcRenderer } from 'electron';

export interface TtsProgressPayload {
  phase: 'gpu' | 'spawn' | 'load' | 'generate' | 'play';
  elapsedMs: number;
}

export type TtsResultPayload =
  | {
      success: true;
      metrics: { modelLoadMs: number; firstAudioMs: number };
      audioDataUrl: string;
    }
  | { success: false; reason: string };

contextBridge.exposeInMainWorld('startupAPI', {
  // Returns { gpu: { available, gpuName?, vramMB? }, serverInstalled,
  // ttsSupported }
  getInfo: () => ipcRenderer.invoke('startup:get-info'),

  // Fire-and-forget: starts the orchestrated TTS bring-up + voice test.
  // Progress arrives via onProgress, the outcome via onResult.
  beginTtsCheck: () => ipcRenderer.invoke('startup:beginTtsCheck'),

  // Aborts an in-flight check, or stops the warm server after a
  // successful one (toggle flipped back to Off).
  cancelTtsCheck: () => ipcRenderer.invoke('startup:cancelTtsCheck'),

  // Called when the test sentence finished playing in the dialog.
  reportAudioFinished: (audioDurationMs: number) =>
    ipcRenderer.invoke('startup:reportAudioFinished', audioDurationMs),

  // Closes the dialog and starts the game with the current voice state.
  launchGame: () => ipcRenderer.invoke('startup:launchGame'),

  onProgress: (cb: (payload: TtsProgressPayload) => void) => {
    ipcRenderer.on(
      'startup:ttsProgress',
      (_e, payload: TtsProgressPayload) => cb(payload)
    );
  },

  onResult: (cb: (payload: TtsResultPayload) => void) => {
    ipcRenderer.on(
      'startup:ttsResult',
      (_e, payload: TtsResultPayload) => cb(payload)
    );
  },
});

console.log('[Startup Menu Preload] Loaded');
