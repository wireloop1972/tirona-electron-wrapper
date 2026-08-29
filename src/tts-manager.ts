/**
 * TTS Manager – Chatterbox Turbo (CUDA-only)
 *
 * Spawns devnen/Chatterbox-TTS-Server via the bundled Portable Mode Python
 * runtime. Only a single Turbo engine is supported; no engine selection.
 * Requires an NVIDIA GPU – call detectNvidiaGpu() first and skip starting
 * the server when no GPU is present.
 */

import { app, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess, execSync } from 'child_process';
import { detectNvidiaGpu, detectAmdGpu, type GpuInfo } from './gpu-detect';
import { matchVoiceFile, voiceStem, FALLBACK_VOICE_STEM } from './voice-resolve';

// =============================================================================
// Types
// =============================================================================

export interface TTSGenerationParams {
  exaggeration?: number;
  cfgWeight?: number;
  temperature?: number;
  speedFactor?: number;
  seed?: number;
}

export interface LocalTTSConfig {
  baseUrl: string;
  defaultVoice: string;
  availableVoices: string[];
}

export interface TTSStatus {
  running: boolean;
  ready: boolean;
  pid?: number;
}

export interface StartServerOptions {
  /** Abort the health-poll wait (e.g. player pressed Cancel). */
  signal?: AbortSignal;
  /** Called right after the Python process spawns, before model loading. */
  onSpawned?: () => void;
  /**
   * Per-line server output (stdout + stderr) while the engine boots. The
   * startup dialog feeds these to its live log so the player can see the
   * model actually loading; model load is the long, silent part of bring-up
   * and its duration is dominated by the GPU.
   */
  onLog?: (line: string) => void;
}

// =============================================================================
// Constants
// =============================================================================

const PORT = 4123;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;
const DEFAULT_VOICE = 'oliverbritmale';
const HEALTH_CHECK_TIMEOUT_MS = 180_000;
const HEALTH_CHECK_INTERVAL_MS = 3_000;

// =============================================================================
// State
// =============================================================================

let currentProcess: ChildProcess | null = null;
let isServerReady = false;
let shuttingDown = false;

// =============================================================================
// Path Resolution
// =============================================================================

const getServerDir = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tts-server');
  }
  return path.join(__dirname, '..', 'tts-server');
};

const getPythonExe = (): string => {
  const serverDir = getServerDir();
  if (process.platform === 'win32') {
    return path.join(serverDir, 'python_embedded', 'python.exe');
  }
  return path.join(serverDir, 'venv', 'bin', 'python');
};

const getServerScript = (): string => {
  const serverDir = getServerDir();
  const sttLauncher = path.join(serverDir, 'launch_with_stt.py');
  if (fs.existsSync(sttLauncher)) return sttLauncher;
  return path.join(serverDir, 'server.py');
};

export const isServerInstalled = (): boolean => {
  const pythonExe = getPythonExe();
  const serverPy = path.join(getServerDir(), 'server.py');
  return fs.existsSync(pythonExe) && fs.existsSync(serverPy);
};

// =============================================================================
// Bundled Backend + GPU Capability
// =============================================================================

/**
 * Which GPU runtime the bundled Python env was built for. Steam ships one
 * env per branch (default = CUDA, amd beta = ROCm) at the SAME path, so the
 * wrapper detects which one it got from the installed torch wheel's local
 * version tag (torch-2.10.0+cu128 vs torch-2.9.1+rocm7.2.1) instead of
 * trusting build-time flags. One code depot then serves both branches, and
 * the gate can never disagree with the bytes actually installed.
 */
export type TtsBackend = 'cuda' | 'rocm';

let cachedBackend: TtsBackend | null | undefined;

export const getBundledBackend = (): TtsBackend | null => {
  if (cachedBackend !== undefined) return cachedBackend;
  try {
    const sitePackages = path.join(
      getServerDir(), 'python_embedded', 'Lib', 'site-packages'
    );
    const torchInfo = fs
      .readdirSync(sitePackages)
      .find(e => /^torch-.*\.dist-info$/i.test(e));
    cachedBackend = !torchInfo
      ? null
      : /rocm/i.test(torchInfo)
        ? 'rocm'
        : /\+cu\d+/i.test(torchInfo)
          ? 'cuda'
          : null;
    console.log(
      `[TTS Manager] Bundled backend: ${cachedBackend ?? 'none'} ` +
      `(${torchInfo ?? 'no torch installed'})`
    );
  } catch {
    cachedBackend = null;
  }
  return cachedBackend;
};

export interface TtsCapability {
  supported: boolean;
  backend: TtsBackend | null;
  gpu: GpuInfo;
  /** Human-readable reason when unsupported. */
  reason?: string;
}

/**
 * Single authority for "can this machine run the bundled voice engine":
 * pairs the env's backend with the matching GPU vendor check. A CUDA env on
 * an AMD-only machine (or vice versa) is correctly unsupported.
 */
export const detectTtsCapability = (): TtsCapability => {
  const backend = getBundledBackend();
  if (backend === 'cuda') {
    const gpu = detectNvidiaGpu();
    return {
      supported: gpu.available,
      backend,
      gpu,
      reason: gpu.available ? undefined : 'no NVIDIA GPU detected',
    };
  }
  if (backend === 'rocm') {
    const gpu = detectAmdGpu();
    return {
      supported: gpu.available,
      backend,
      gpu,
      reason: gpu.available
        ? undefined
        : 'no supported AMD GPU (needs RX 7700 XT or newer / RX 9000 series)',
    };
  }
  return {
    supported: false,
    backend: null,
    gpu: { available: false },
    reason: 'voice engine runtime not found',
  };
};

// =============================================================================
// Health Check
// =============================================================================

const waitForHealth = async (signal?: AbortSignal): Promise<boolean> => {
  const startTime = Date.now();
  // /api/model-info reports loaded=true only once the model is actually in
  // GPU memory. The plain HTTP-up endpoints answer earlier, while the model
  // is still loading, and generation requests would get a 503.
  const healthUrl = `${BASE_URL}/api/model-info`;

  console.log(`[TTS Manager] Waiting for Turbo server at ${healthUrl}...`);

  while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT_MS) {
    if (signal?.aborted) {
      console.log('[TTS Manager] Health wait aborted');
      return false;
    }
    if (!currentProcess) {
      console.error('[TTS Manager] Server process exited during startup');
      return false;
    }
    try {
      const res = await fetch(healthUrl, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const info = (await res.json()) as { loaded?: boolean };
        if (info.loaded === true) {
          console.log('[TTS Manager] Turbo server is ready (model loaded)');
          isServerReady = true;
          return true;
        }
      }
    } catch {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed % 15 === 0) {
        console.log(
          `[TTS Manager] Still waiting (${elapsed}s elapsed)...`
        );
      }
    }
    await new Promise(r => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
  }

  console.error('[TTS Manager] Turbo server did not become ready in time');
  return false;
};

// =============================================================================
// Voice Fetching
// =============================================================================

export const fetchVoices = async (): Promise<string[]> => {
  try {
    const res = await fetch(`${BASE_URL}/get_predefined_voices`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      // The devnen server returns a bare array of
      // { display_name, filename } objects.
      const data = (await res.json()) as Array<{
        display_name?: string;
        filename?: string;
      }>;
      if (Array.isArray(data) && data.length > 0) {
        const names = data
          .map(v => v.filename || v.display_name || '')
          .filter(Boolean);
        if (names.length > 0) return names;
      }
    }
  } catch (err) {
    console.warn('[TTS Manager] Could not fetch voices:', err);
  }
  return ['default'];
};

const buildConfig = (voices: string[]): LocalTTSConfig => {
  const match = voices.find(v => voiceStem(v) === DEFAULT_VOICE);
  return {
    baseUrl: `${BASE_URL}/v1`,
    defaultVoice: match ?? voices[0] ?? DEFAULT_VOICE,
    availableVoices: voices,
  };
};

// =============================================================================
// Voice Resolution
// =============================================================================

// The predefined-voice list is fixed for a given server run, so cache it and
// avoid a localhost round-trip on every speak. A non-placeholder result is
// cached; transient fetch failures ('default') leave the cache untouched.
let voiceFileCache: string[] = [];

const getVoiceFiles = async (forceRefresh = false): Promise<string[]> => {
  if (!forceRefresh && voiceFileCache.length > 0) return voiceFileCache;
  const voices = await fetchVoices();
  const real = voices.filter(v => v && v !== 'default');
  if (real.length > 0) voiceFileCache = real;
  return voiceFileCache;
};

/**
 * Resolve a renderer-supplied voice name ('narrator', 'Bodin', 'Malineth', …)
 * to the exact predefined-voice filename the Chatterbox server expects
 * ('Narrator.wav', 'Bodin.mp3', …). Matching is case-insensitive and
 * extension-agnostic; unknown or missing names fall back to the narrator, then
 * to any installed voice, so the server never receives a name it will 404 on.
 * Returns null only when the server exposes no predefined voices at all.
 * See ./voice-resolve for the matching rules.
 */
export const resolvePredefinedVoice = async (
  requested?: string
): Promise<string | null> => {
  // Probe the cache without fallback so we can tell a genuine miss (e.g. a
  // voice file added since the cache was primed) from a deliberate fallback.
  let match = matchVoiceFile(await getVoiceFiles(), requested, false);
  if (!match) {
    match = matchVoiceFile(await getVoiceFiles(true), requested, false);
  }
  // Still nothing → narrator, then any available voice.
  if (!match) {
    match = matchVoiceFile(await getVoiceFiles(), FALLBACK_VOICE_STEM, true);
  }
  return match;
};

// =============================================================================
// Port / Process Cleanup
// =============================================================================

const killProcessOnPort = (port: number): void => {
  try {
    if (process.platform === 'win32') {
      try {
        const result = execSync(
          `netstat -ano | findstr :${port} | findstr LISTENING`,
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
        );
        const pids = new Set<string>();
        for (const line of result.trim().split('\n')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
        }
        for (const pid of pids) {
          console.log(`[TTS Manager] Killing PID ${pid} on port ${port}`);
          try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); }
          catch { /* ignore */ }
        }
      } catch { /* no process on port */ }
    } else {
      try {
        const result = execSync(`lsof -ti :${port}`, {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
        });
        for (const pid of result.trim().split('\n').filter(Boolean)) {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        }
      } catch { /* no process on port */ }
    }
  } catch (err) {
    console.error(`[TTS Manager] Error cleaning port ${port}:`, err);
  }
};

const cleanupOrphans = (): void => {
  console.log('[TTS Manager] Cleaning up orphan processes...');
  if (process.platform === 'win32') {
    try {
      execSync(
        'taskkill /F /IM python.exe /FI "WINDOWTITLE eq Chatterbox*"',
        { stdio: 'ignore' }
      );
    } catch { /* none found */ }
  }
  killProcessOnPort(PORT);
};

// =============================================================================
// Engine Lifecycle
// =============================================================================

export const stopServer = (): void => {
  shuttingDown = true;
  const pid = currentProcess?.pid;

  if (!currentProcess || !pid) {
    console.log('[TTS Manager] No server running');
    killProcessOnPort(PORT);
    return;
  }

  console.log(`[TTS Manager] Stopping server (PID ${pid})...`);
  isServerReady = false;

  try {
    if (process.platform === 'win32') {
      try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); }
      catch { /* ok */ }
    } else {
      currentProcess.kill('SIGTERM');
      setTimeout(() => {
        if (currentProcess && !currentProcess.killed) {
          currentProcess.kill('SIGKILL');
        }
      }, 3000);
    }
  } catch (err) {
    console.error('[TTS Manager] Error stopping server:', err);
  }

  setTimeout(() => killProcessOnPort(PORT), 1000);
  currentProcess = null;
};

export const startServer = async (
  options?: StartServerOptions
): Promise<LocalTTSConfig> => {
  const cap = detectTtsCapability();
  if (!cap.supported) {
    throw new Error(cap.reason ?? 'no compatible GPU for the voice engine');
  }
  if (options?.signal?.aborted) {
    throw new Error('TTS startup cancelled');
  }

  shuttingDown = false;

  if (currentProcess) {
    stopServer();
    await new Promise(r => setTimeout(r, 2000));
  }

  cleanupOrphans();

  const pythonExe = getPythonExe();
  const serverDir = getServerDir();
  const serverScript = getServerScript();

  if (!fs.existsSync(pythonExe)) {
    throw new Error(`Bundled Python not found at: ${pythonExe}`);
  }
  if (!fs.existsSync(serverScript)) {
    throw new Error(`Server script not found at: ${serverScript}`);
  }

  console.log(`[TTS Manager] Spawning: ${pythonExe} ${serverScript}`);

  const spawnEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    // Load the AI model from the cache bundled inside tts-server, and never
    // reach the network: this is a Steam build with no external dependencies.
    HF_HOME: path.join(serverDir, 'hf_cache'),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    // ChatterboxTurboTTS.from_pretrained passes `token=True` to
    // snapshot_download, which raises LocalTokenNotFoundError on any
    // machine with no HF login - even fully offline. A placeholder
    // satisfies that code path; HF_HUB_OFFLINE=1 means it is never sent.
    HF_TOKEN: 'offline',
  };

  if (cap.backend === 'rocm') {
    // faster-whisper rides CTranslate2, which is CUDA-only for GPU. On ROCm,
    // torch.cuda.is_available() is TRUE (HIP masquerades as CUDA), so the
    // stt_addon's own fallback never triggers and STT would crash the server.
    // Force CPU STT on AMD; TTS itself still runs on the GPU via HIP.
    spawnEnv.STT_DEVICE = 'cpu';
    spawnEnv.STT_COMPUTE_TYPE = 'int8';
    // ROCm torch links LLVM OpenMP (libomp140) while CTranslate2 ships
    // Intel OpenMP (libiomp5md); loading both aborts the process with OMP
    // Error #15. Intel's documented escape hatch is the only way to run
    // them in one process. CUDA builds don't hit this (single runtime).
    spawnEnv.KMP_DUPLICATE_LIB_OK = 'TRUE';
  }

  currentProcess = spawn(pythonExe, [serverScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: spawnEnv,
    cwd: serverDir,
  });

  // One data event can carry several log lines; split so subscribers get one
  // line at a time (the dialog renders them as individual rows).
  const emitLines = (chunk: string): void => {
    if (!options?.onLog) return;
    for (const line of chunk.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) options.onLog(trimmed.slice(0, 300));
    }
  };

  if (currentProcess.stdout) {
    currentProcess.stdout.on('data', (buf: Buffer) => {
      const msg = buf.toString().trim();
      if (!msg) return;
      console.log(`[voice-engine] ${msg}`);
      emitLines(msg);
    });
  }
  if (currentProcess.stderr) {
    currentProcess.stderr.on('data', (buf: Buffer) => {
      const msg = buf.toString().trim();
      if (!msg) return;
      // The engine logs progress to stderr as well, so this is not an error
      // channel in practice - forward it to the dialog like stdout.
      console.error(`[voice-engine err] ${msg}`);
      emitLines(msg);
    });
  }

  currentProcess.on('exit', (code, signal) => {
    console.log(
      `[TTS Manager] Server exited (code=${code}, signal=${signal})`
    );
    const wasReady = isServerReady;
    currentProcess = null;
    isServerReady = false;

    // Only surface an OS dialog for crashes after a successful start;
    // bring-up failures are reported by the caller (startup dialog).
    if (code !== 0 && code !== null && !shuttingDown && wasReady) {
      dialog.showErrorBox(
        'Voice Synthesis Error',
        `The narrator voice engine stopped unexpectedly (code ${code}).\n` +
        'Voice features may not work. Restart the application.'
      );
    }
  });

  currentProcess.on('error', (err: Error) => {
    console.error('[TTS Manager] Failed to start server:', err);
    currentProcess = null;
    isServerReady = false;
  });

  console.log(`[TTS Manager] Server PID: ${currentProcess.pid}`);
  options?.onSpawned?.();

  const ready = await waitForHealth(options?.signal);
  if (!ready) {
    const aborted = options?.signal?.aborted === true;
    const crashed = !aborted && currentProcess === null;
    stopServer();
    throw new Error(
      aborted
        ? 'TTS startup cancelled'
        : crashed
          ? 'voice server exited during startup'
          : 'voice server did not become ready in time'
    );
  }

  return buildConfig(await fetchVoices());
};

// =============================================================================
// External Server Detection
// =============================================================================

const detectExternalServer = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${BASE_URL}/api/model-info`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const info = (await res.json()) as { loaded?: boolean };
    return info.loaded === true;
  } catch {
    return false;
  }
};

// =============================================================================
// Status / Getters
// =============================================================================

export const getStatus = async (): Promise<TTSStatus> => {
  if (currentProcess !== null) {
    return { running: true, ready: isServerReady, pid: currentProcess.pid };
  }
  const external = await detectExternalServer();
  if (external) {
    return { running: true, ready: true };
  }
  return { running: false, ready: false };
};

export const getConfig = async (): Promise<LocalTTSConfig | null> => {
  const status = await getStatus();
  if (!status.running || !status.ready) return null;

  return buildConfig(await fetchVoices());
};

export const getBaseUrl = async (): Promise<string | null> => {
  const status = await getStatus();
  return status.ready ? BASE_URL : null;
};

// =============================================================================
// STT – Speech-to-Text (faster-whisper via /stt endpoint)
// =============================================================================

export interface STTResult {
  text: string;
  language: string;
  duration: number;
}

export const transcribeAudio = async (
  audioBuffer: Buffer,
  filename = 'recording.webm'
): Promise<STTResult> => {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) {
    throw new Error('Python server is not running');
  }

  const blob = new Blob([audioBuffer]);
  const form = new FormData();
  form.append('audio', blob, filename);

  const res = await fetch(`${BASE_URL}/stt`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`STT HTTP ${res.status}: ${errBody}`);
  }

  return (await res.json()) as STTResult;
};
