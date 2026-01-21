/**
 * TypeScript definitions for Electron preload API
 * These types are available in the Next.js renderer process
 */

// =============================================================================
// TTS Engine Types
// =============================================================================

type TTSEngine = 'chatterbox';

interface LocalTTSConfig {
  engine: TTSEngine;
  baseUrl: string;          // e.g. 'http://127.0.0.1:5005/v1'
  model: string;            // 'orpheus' or 'tts-1'
  defaultVoice: string;     // 'tara', 'default', etc.
  availableVoices: string[];
}

interface TTSEngineInfo {
  id: TTSEngine;
  name: string;             // UI display name
  installed: boolean;
}

interface TTSStatus {
  running: boolean;
  ready: boolean;
  engine: TTSEngine | null;
  pid?: number;
}

interface SpeakResult {
  success: boolean;
  audioUrl?: string;
  error?: string;
}

interface VoicesResult {
  voices: string[];
  error?: string;
}

// =============================================================================
// Local TTS API (New Unified API)
// =============================================================================

interface LocalTTSAPI {
  /** Get list of installed TTS engines */
  getEngines: () => Promise<TTSEngineInfo[]>;
  
  /** Start a TTS engine (stops any currently running engine first) */
  start: (engineId: TTSEngine) => Promise<LocalTTSConfig>;
  
  /** Stop the currently running TTS engine */
  stop: () => Promise<{ success: boolean }>;
  
  /** Get current TTS engine config (if running) */
  getConfig: () => Promise<LocalTTSConfig | null>;
  
  /** Get current TTS engine status */
  getStatus: () => Promise<TTSStatus>;
  
  /** Generate speech using the current TTS engine */
  speak: (text: string, voice: string) => Promise<SpeakResult>;
  
  /** Get available voices for the current TTS engine */
  getVoices: () => Promise<VoicesResult>;
  
  /** Listen for TTS ready notification (pushed from main process after engine starts) */
  onReady: (callback: (config: LocalTTSConfig) => void) => void;
  
  /** Remove ready listener */
  removeReadyListener: () => void;
}

// =============================================================================
// Legacy Orpheus API (for backwards compatibility)
// =============================================================================

interface OrpheusStatus {
  running: boolean;
  ready: boolean;
  pid?: number;
  url: string;
}

interface OrpheusAPI {
  getStatus: () => Promise<OrpheusStatus>;
  start: () => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean }>;
  getVoices: () => Promise<VoicesResult>;
  speak: (text: string, voice: string) => Promise<SpeakResult>;
  onReady: (callback: (voices: string[]) => void) => void;
  removeReadyListener: () => void;
}

// =============================================================================
// Window Control API
// =============================================================================

interface WindowControlAPI {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  toggleFullscreen: () => void;
  isFullscreen: () => Promise<boolean>;
  setSize: (width: number, height: number) => void;
  getSize: () => Promise<{ width: number; height: number }>;
}

// =============================================================================
// Main Electron API
// =============================================================================

interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  onSplashFinished: (callback: () => void) => void;
  removeSplashListener: (callback: () => void) => void;
  window: WindowControlAPI;
  openSettings: () => void;
  /** @deprecated Use window.localTTS instead */
  orpheus: OrpheusAPI;
}

// =============================================================================
// Window Global Declarations
// =============================================================================

interface Window {
  IN_DESKTOP_ENV?: boolean;
  DESKTOP_ENV?: { isElectron: boolean };
  ORPHEUS_TTS_URL?: string;
  electron?: ElectronAPI;
  /** New unified TTS API - supports Orpheus and Chatterbox */
  localTTS?: LocalTTSAPI;
}

declare const IN_DESKTOP_ENV: boolean | undefined;
declare const ORPHEUS_TTS_URL: string | undefined;
