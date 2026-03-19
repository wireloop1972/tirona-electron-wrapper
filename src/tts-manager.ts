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
import { detectNvidiaGpu } from './gpu-detect';

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
// Health Check
// =============================================================================

const waitForHealth = async (): Promise<boolean> => {
  const startTime = Date.now();
  const healthUrl = `${BASE_URL}/api/ui/initial-data`;

  console.log(`[TTS Manager] Waiting for Turbo server at ${healthUrl}...`);

  while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT_MS) {
    try {
      const res = await fetch(healthUrl, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        console.log('[TTS Manager] Turbo server is ready');
        isServerReady = true;
        return true;
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
      const data = (await res.json()) as {
        voices?: Array<{ id: string; name: string }>;
      };
      if (data.voices && data.voices.length > 0) {
        return data.voices.map(v => v.id || v.name);
      }
    }
  } catch (err) {
    console.warn('[TTS Manager] Could not fetch voices:', err);
  }
  return ['default'];
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
    try { execSync('taskkill /F /IM python.exe /FI "WINDOWTITLE eq Chatterbox*"', { stdio: 'ignore' }); }
    catch { /* none found */ }
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

export const startServer = async (): Promise<LocalTTSConfig> => {
  const gpu = detectNvidiaGpu();
  if (!gpu.available) {
    throw new Error(
      'No NVIDIA GPU detected. Chatterbox Turbo requires a CUDA-capable GPU.'
    );
  }

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
  };

  currentProcess = spawn(pythonExe, [serverScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: spawnEnv,
    cwd: serverDir,
  });

  if (currentProcess.stdout) {
    currentProcess.stdout.on('data', (buf: Buffer) => {
      const msg = buf.toString().trim();
      if (msg) console.log(`[chatterbox-turbo] ${msg}`);
    });
  }
  if (currentProcess.stderr) {
    currentProcess.stderr.on('data', (buf: Buffer) => {
      const msg = buf.toString().trim();
      if (msg) console.error(`[chatterbox-turbo err] ${msg}`);
    });
  }

  currentProcess.on('exit', (code, signal) => {
    console.log(
      `[TTS Manager] Server exited (code=${code}, signal=${signal})`
    );
    currentProcess = null;
    isServerReady = false;

    if (code !== 0 && code !== null && !shuttingDown) {
      dialog.showErrorBox(
        'TTS Engine Error',
        `Chatterbox Turbo stopped unexpectedly (code ${code}).\n` +
        'Voice features may not work. Restart the application.'
      );
    }
  });

  currentProcess.on('error', (err: Error) => {
    console.error('[TTS Manager] Failed to start server:', err);
    currentProcess = null;
    isServerReady = false;
    dialog.showErrorBox(
      'TTS Engine Error',
      `Failed to start Chatterbox Turbo:\n${err.message}`
    );
  });

  console.log(`[TTS Manager] Server PID: ${currentProcess.pid}`);

  const ready = await waitForHealth();
  if (!ready) {
    stopServer();
    throw new Error('Chatterbox Turbo failed to start within timeout');
  }

  const voices = await fetchVoices();

  return {
    baseUrl: `${BASE_URL}/v1`,
    defaultVoice: voices.includes(DEFAULT_VOICE)
      ? DEFAULT_VOICE
      : (voices[0] ?? DEFAULT_VOICE),
    availableVoices: voices,
  };
};

// =============================================================================
// External Server Detection
// =============================================================================

const detectExternalServer = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${BASE_URL}/api/ui/initial-data`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
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

  const voices = await fetchVoices();
  return {
    baseUrl: `${BASE_URL}/v1`,
    defaultVoice: voices.includes(DEFAULT_VOICE)
      ? DEFAULT_VOICE
      : (voices[0] ?? DEFAULT_VOICE),
    availableVoices: voices,
  };
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
