import { contextBridge, ipcRenderer } from 'electron';

export interface TtsProgressPayload {
  phase: 'gpu' | 'spawn' | 'load' | 'generate' | 'play';
  elapsedMs: number;
}

export interface TtsLogPayload {
  /** One raw line of voice-server output. */
  line: string;
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
  // Returns { gpu: { available, gpuName?, vramMB? }, backend, serverInstalled,
  // ttsSupported }
  getInfo: () => ipcRenderer.invoke('startup:get-info'),

  // Fire-and-forget: starts the orchestrated TTS bring-up + voice test.
  // Progress arrives via onProgress, the outcome via onResult.
  beginTtsCheck: () => ipcRenderer.invoke('startup:beginTtsCheck'),

  // Aborts an in-flight check, or stops the warm server after a
  // successful one (the player stepped back out of the load).
  cancelTtsCheck: () => ipcRenderer.invoke('startup:cancelTtsCheck'),

  // Called when the test sentence finished playing in the dialog.
  reportAudioFinished: (audioDurationMs: number) =>
    ipcRenderer.invoke('startup:reportAudioFinished', audioDurationMs),

  // Closes the dialog and starts the game with the current voice state.
  launchGame: () => ipcRenderer.invoke('startup:launchGame'),

  // The launcher window is frameless and draws its own controls.
  minimizeWindow: () => ipcRenderer.send('startup:minimize'),
  closeWindow: () => ipcRenderer.send('startup:close'),

  // Raw engine output, put on the clipboard for support rather than on
  // screen. Only reachable from the failure state.
  copyDiagnostics: (text: string) =>
    ipcRenderer.send('startup:copyDiagnostics', text),

  onProgress: (cb: (payload: TtsProgressPayload) => void) => {
    ipcRenderer.on(
      'startup:ttsProgress',
      (_e, payload: TtsProgressPayload) => cb(payload)
    );
  },

  // Live voice-server output during bring-up, one line per call. The dialog
  // rewrites these into player-facing wording before showing them.
  onLog: (cb: (payload: TtsLogPayload) => void) => {
    ipcRenderer.on(
      'startup:ttsLog',
      (_e, payload: TtsLogPayload) => cb(payload)
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
