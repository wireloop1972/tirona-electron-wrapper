/**
 * TypeScript definitions for the Tirona Electron preload API.
 * Available in the Next.js renderer process.
 */

// =============================================================================
// GPU Detection
// =============================================================================

interface GpuInfo {
  available: boolean;
  gpuName?: string;
  vramMB?: number;
}

// =============================================================================
// TTS Types
// =============================================================================

interface TTSGenerationParams {
  exaggeration?: number;
  cfgWeight?: number;
  temperature?: number;
  speedFactor?: number;
  seed?: number;
}

interface LocalTTSConfig {
  baseUrl: string;
  defaultVoice: string;
  availableVoices: string[];
}

interface TTSStatus {
  running: boolean;
  ready: boolean;
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
// Local TTS API
// =============================================================================

interface LocalTTSAPI {
  /** Check if an NVIDIA CUDA GPU is available */
  isGpuAvailable: () => Promise<GpuInfo>;

  /** Check if the bundled TTS server files exist */
  isInstalled: () => Promise<boolean>;

  /** Start the Chatterbox Turbo server (requires NVIDIA GPU) */
  start: () => Promise<LocalTTSConfig>;

  /** Stop the running TTS server */
  stop: () => Promise<{ success: boolean }>;

  /** Get current TTS config (if running) */
  getConfig: () => Promise<LocalTTSConfig | null>;

  /** Get current TTS server status */
  getStatus: () => Promise<TTSStatus>;

  /** Generate speech with optional per-request generation parameters */
  speak: (
    text: string,
    voice?: string,
    params?: TTSGenerationParams
  ) => Promise<SpeakResult>;

  /** Get available predefined voices */
  getVoices: () => Promise<VoicesResult>;

  /** Listen for TTS ready notification */
  onReady: (callback: (config: LocalTTSConfig) => void) => void;

  /** Remove ready listener */
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
}

// =============================================================================
// Window Global Declarations
// =============================================================================

interface Window {
  IN_DESKTOP_ENV?: boolean;
  DESKTOP_ENV?: { isElectron: boolean };
  electron?: ElectronAPI;
  localTTS?: LocalTTSAPI;
}

declare const IN_DESKTOP_ENV: boolean | undefined;
