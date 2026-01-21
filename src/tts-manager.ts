/**
 * TTS Engine Manager
 * Manager for local Chatterbox TTS engine
 * Only one engine can run at a time
 * 
 * Note: Legacy "orpheus" API naming is preserved for backwards compatibility
 * with the Next.js battlemap, but all calls route to Chatterbox.
 */

import { app, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess, execSync } from 'child_process';

// =============================================================================
// Types
// =============================================================================

export type TTSEngine = 'chatterbox';

export interface TTSEngineConfig {
  type: TTSEngine;
  name: string;
  port: number;
  basePath: string;
  healthEndpoint: string;
  binaryName: string;
  defaultModel: string;
  defaultVoice: string;
  args: (modelsDir: string, port: number) => string[];
}

export interface LocalTTSConfig {
  engine: TTSEngine;
  baseUrl: string;
  model: string;
  defaultVoice: string;
  availableVoices: string[];
}

export interface TTSEngineInfo {
  id: TTSEngine;
  name: string;
  installed: boolean;
}

// =============================================================================
// Engine Configurations
// =============================================================================

const ENGINE_CONFIGS: Record<TTSEngine, TTSEngineConfig> = {
  chatterbox: {
    type: 'chatterbox',
    name: 'Chatterbox (Local GPU)',
    port: 4123,
    basePath: '/v1',
    healthEndpoint: '/health',  // Standard liveness probe
    binaryName: 'chatterbox_server',
    defaultModel: 'tts-1',
    defaultVoice: 'default',    // Chatterbox uses voice samples, not named voices
    args: (_modelsDir, port) => ['--port', String(port)],
  },
};

// =============================================================================
// Constants
// =============================================================================

const HEALTH_CHECK_TIMEOUT_MS = 120000; // 2 minutes (model loading takes time)
const HEALTH_CHECK_INTERVAL_MS = 3000;  // 3 seconds
const HOST = '127.0.0.1';

// =============================================================================
// State
// =============================================================================

let currentProcess: ChildProcess | null = null;
let currentEngine: TTSEngine | null = null;
let isServerReady = false;

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Get the path to a TTS engine binary
 */
export const getEngineBinaryPath = (engine: TTSEngine): string => {
  const config = ENGINE_CONFIGS[engine];
  const isPackaged = app.isPackaged;
  const platform = process.platform;
  const exeName = platform === 'win32' 
    ? `${config.binaryName}.exe` 
    : config.binaryName;

  if (isPackaged) {
    // In packaged app: resources/{engine}/{binary}
    return path.join(process.resourcesPath, engine, exeName);
  } else {
    // In development: tts-binaries/{engine}_server/{binary}
    return path.join(__dirname, '..', 'tts-binaries', `${engine}_server`, exeName);
  }
};

/**
 * Get the models directory for an engine
 */
export const getModelsDir = (engine: TTSEngine): string => {
  return path.join(app.getPath('userData'), `${engine}_models`);
};

/**
 * Check if an engine binary exists
 */
export const isEngineInstalled = (engine: TTSEngine): boolean => {
  const binaryPath = getEngineBinaryPath(engine);
  return fs.existsSync(binaryPath);
};

// =============================================================================
// Engine Detection
// =============================================================================

/**
 * Get list of installed TTS engines
 */
export const getInstalledEngines = (): TTSEngineInfo[] => {
  const engines: TTSEngineInfo[] = [];

  for (const [id, config] of Object.entries(ENGINE_CONFIGS)) {
    const engineId = id as TTSEngine;
    const installed = isEngineInstalled(engineId);
    
    engines.push({
      id: engineId,
      name: config.name,
      installed,
    });

    console.log(`[TTS Manager] Engine ${engineId}: ${installed ? '✓ installed' : '✗ not found'}`);
  }

  return engines;
};

// =============================================================================
// Health Check
// =============================================================================

/**
 * Wait for TTS server to become healthy
 */
const waitForHealth = async (engine: TTSEngine): Promise<boolean> => {
  const config = ENGINE_CONFIGS[engine];
  const startTime = Date.now();
  const healthUrl = `http://${HOST}:${config.port}${config.healthEndpoint}`;

  console.log(`[TTS Manager] Waiting for ${engine} to become ready...`);
  console.log(`[TTS Manager] Health endpoint: ${healthUrl}`);

  while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT_MS) {
    try {
      const response = await fetch(healthUrl);

      if (response.ok) {
        console.log(`[TTS Manager] ${engine} is ready!`);
        isServerReady = true;
        return true;
      }
    } catch {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[TTS Manager] Health check failed (${elapsed}s elapsed), retrying...`);
    }

    await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
  }

  console.error(`[TTS Manager] ${engine} failed to become ready within timeout`);
  return false;
};

// =============================================================================
// Voice Fetching
// =============================================================================

/**
 * Fetch available voices from the running engine
 * 
 * Chatterbox API: GET /voices → {voices: [{name: "...", ...}], count: N}
 */
export const fetchVoices = async (engine: TTSEngine): Promise<string[]> => {
  const config = ENGINE_CONFIGS[engine];

  try {
    // Chatterbox uses /voices endpoint with different response format
    const voicesUrl = `http://${HOST}:${config.port}/voices`;
    const response = await fetch(voicesUrl);
    
    if (response.ok) {
      const data = await response.json() as { 
        voices?: Array<{ name: string; [key: string]: unknown }>;
        count?: number;
      };
      
      // Extract voice names from the array of voice objects
      if (data.voices && Array.isArray(data.voices) && data.voices.length > 0) {
        return data.voices.map(v => v.name);
      }
    }
    
    // Chatterbox with no uploaded voices uses default voice
    console.log('[TTS Manager] Chatterbox has no custom voices, using default');
    return [config.defaultVoice];
  } catch (error) {
    console.warn(`[TTS Manager] Could not fetch voices for ${engine}:`, error);
  }

  // Return default voice if fetch fails
  return [config.defaultVoice];
};

// =============================================================================
// Process Cleanup
// =============================================================================

/**
 * Kill any process using a specific port
 */
const killProcessOnPort = (port: number): void => {
  try {
    if (process.platform === 'win32') {
      console.log(`[TTS Manager] Checking for processes on port ${port}...`);
      try {
        const result = execSync(
          `netstat -ano | findstr :${port} | findstr LISTENING`,
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
        );

        const lines = result.trim().split('\n');
        const pids = new Set<string>();

        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== '0') {
            pids.add(pid);
          }
        }

        for (const pid of pids) {
          console.log(`[TTS Manager] Killing process ${pid} on port ${port}`);
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          } catch {
            // Ignore
          }
        }
      } catch {
        console.log(`[TTS Manager] No process found on port ${port}`);
      }
    } else {
      try {
        const result = execSync(`lsof -ti :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        const pids = result.trim().split('\n').filter(Boolean);

        for (const pid of pids) {
          console.log(`[TTS Manager] Killing process ${pid} on port ${port}`);
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        }
      } catch {
        console.log(`[TTS Manager] No process found on port ${port}`);
      }
    }
  } catch (error) {
    console.error(`[TTS Manager] Error cleaning up port ${port}:`, error);
  }
};

/**
 * Clean up orphan processes for a specific engine
 */
const cleanupOrphanProcesses = (engine: TTSEngine): void => {
  const config = ENGINE_CONFIGS[engine];
  console.log(`[TTS Manager] Cleaning up orphan ${engine} processes...`);

  try {
    if (process.platform === 'win32') {
      const exeName = `${config.binaryName}.exe`;
      try {
        execSync(`taskkill /F /IM ${exeName}`, { stdio: 'ignore' });
        console.log(`[TTS Manager] Killed orphan ${exeName} processes`);
      } catch {
        // No orphan processes
      }
    } else {
      try {
        execSync(`pkill -f ${config.binaryName}`, { stdio: 'ignore' });
      } catch {
        // No orphan processes
      }
    }

    // Also clean up the port
    killProcessOnPort(config.port);
  } catch (error) {
    console.error(`[TTS Manager] Error during orphan cleanup:`, error);
  }
};

// =============================================================================
// Engine Lifecycle
// =============================================================================

/**
 * Stop the currently running TTS engine
 */
export const stopCurrentEngine = (): void => {
  const pid = currentProcess?.pid;
  const engine = currentEngine;

  if (!currentProcess || !pid) {
    console.log('[TTS Manager] No engine currently running');
    // Still clean up ports as a failsafe
    for (const config of Object.values(ENGINE_CONFIGS)) {
      killProcessOnPort(config.port);
    }
    return;
  }

  console.log(`[TTS Manager] Stopping ${engine} (PID: ${pid})...`);
  isServerReady = false;

  try {
    if (process.platform === 'win32') {
      console.log('[TTS Manager] Using taskkill for Windows...');
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      } catch {
        console.log('[TTS Manager] taskkill finished');
      }
    } else {
      currentProcess.kill('SIGTERM');
      setTimeout(() => {
        if (currentProcess && !currentProcess.killed) {
          console.warn('[TTS Manager] Server did not stop gracefully, forcing...');
          currentProcess.kill('SIGKILL');
        }
      }, 3000);
    }
  } catch (error) {
    console.error('[TTS Manager] Error stopping engine:', error);
  }

  // Clean up the port as failsafe
  if (engine) {
    const config = ENGINE_CONFIGS[engine];
    setTimeout(() => killProcessOnPort(config.port), 1000);
  }

  currentProcess = null;
  currentEngine = null;
};

/**
 * Start a TTS engine
 * @returns LocalTTSConfig if successful
 */
export const startEngine = async (engine: TTSEngine): Promise<LocalTTSConfig> => {
  console.log(`[TTS Manager] Starting ${engine}...`);

  // Stop any currently running engine
  if (currentProcess) {
    console.log(`[TTS Manager] Stopping current engine (${currentEngine}) first...`);
    stopCurrentEngine();
    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Clean up orphan processes
  cleanupOrphanProcesses(engine);

  const config = ENGINE_CONFIGS[engine];
  const binaryPath = getEngineBinaryPath(engine);
  const modelsDir = getModelsDir(engine);

  // Check if binary exists
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`${engine} binary not found at: ${binaryPath}`);
  }

  // Ensure models directory exists
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  // Make binary executable on Unix
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(binaryPath, 0o755);
    } catch (error) {
      console.warn('[TTS Manager] Failed to set executable permissions:', error);
    }
  }

  // Build command args
  const args = config.args(modelsDir, config.port);

  console.log(`[TTS Manager] Spawning: ${binaryPath}`);
  console.log(`[TTS Manager] Args: ${args.join(' ')}`);

  // Build environment variables
  const spawnEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };

  // For Chatterbox, set voice sample path
  if (engine === 'chatterbox') {
    const voiceSamplePath = path.join(path.dirname(binaryPath), 'voice-sample.wav');
    spawnEnv.VOICE_SAMPLE_PATH = voiceSamplePath;
    console.log(`[TTS Manager] Chatterbox voice sample: ${voiceSamplePath}`);
  }

  // Spawn the process with UTF-8 encoding for Windows compatibility
  // (Chatterbox uses emojis in log messages that crash on Windows cp1252)
  currentProcess = spawn(binaryPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: spawnEnv,
    cwd: path.dirname(binaryPath), // Set working directory to binary location
  });

  currentEngine = engine;

  // Log stdout
  if (currentProcess.stdout) {
    currentProcess.stdout.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        console.log(`[${engine}] ${message}`);
      }
    });
  }

  // Log stderr
  if (currentProcess.stderr) {
    currentProcess.stderr.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        console.error(`[${engine} Error] ${message}`);
      }
    });
  }

  // Handle process exit
  currentProcess.on('exit', (code, signal) => {
    console.log(`[TTS Manager] ${engine} exited with code ${code} (signal: ${signal})`);
    currentProcess = null;
    currentEngine = null;
    isServerReady = false;

    if (code !== 0 && code !== null) {
      dialog.showErrorBox(
        'TTS Engine Error',
        `The ${config.name} stopped unexpectedly (code: ${code}).\n\n` +
        `Voice features may not work. Please restart the application or try a different engine.`
      );
    }
  });

  // Handle process errors
  currentProcess.on('error', (error: Error) => {
    console.error(`[TTS Manager] Failed to start ${engine}:`, error);
    currentProcess = null;
    currentEngine = null;
    isServerReady = false;

    dialog.showErrorBox(
      'TTS Engine Error',
      `Failed to start ${config.name}:\n${error.message}\n\n` +
      `Voice features will not be available.`
    );
  });

  console.log(`[TTS Manager] ${engine} process started (PID: ${currentProcess.pid})`);

  // Wait for health check
  const ready = await waitForHealth(engine);

  if (!ready) {
    stopCurrentEngine();
    throw new Error(`${engine} failed to start within timeout`);
  }

  // Fetch available voices
  const voices = await fetchVoices(engine);

  // Return the config
  return {
    engine,
    baseUrl: `http://${HOST}:${config.port}${config.basePath}`,
    model: config.defaultModel,
    defaultVoice: config.defaultVoice,
    availableVoices: voices,
  };
};

// =============================================================================
// External Server Detection
// =============================================================================

/**
 * Check if an external TTS server is running (not started by Electron)
 * Returns the engine type if found, null otherwise
 */
const detectExternalServer = async (): Promise<TTSEngine | null> => {
  // Check Chatterbox (port 4123)
  try {
    const res = await fetch(`http://${HOST}:${ENGINE_CONFIGS.chatterbox.port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = await res.json() as { status?: string; model_loaded?: boolean };
      if (data.status === 'healthy' && data.model_loaded) {
        console.log('[TTS Manager] Detected external Chatterbox server');
        return 'chatterbox';
      }
    }
  } catch {
    // Not running
  }

  return null;
};

// =============================================================================
// Status & Getters
// =============================================================================

/**
 * Get current engine status
 * Also checks for externally-running servers
 */
export const getCurrentStatus = async () => {
  // If we have a managed process, return its status
  if (currentProcess !== null) {
    return {
      running: true,
      ready: isServerReady,
      engine: currentEngine,
      pid: currentProcess?.pid,
    };
  }

  // Check for external server
  const externalEngine = await detectExternalServer();
  if (externalEngine) {
    return {
      running: true,
      ready: true,
      engine: externalEngine,
      pid: undefined,
    };
  }

  return {
    running: false,
    ready: false,
    engine: null,
    pid: undefined,
  };
};

/**
 * Get current engine config (if running)
 * Also checks for externally-running servers
 */
export const getCurrentConfig = async (): Promise<LocalTTSConfig | null> => {
  // If we have a managed engine, return its config
  if (currentEngine && isServerReady) {
    const config = ENGINE_CONFIGS[currentEngine];
    const voices = await fetchVoices(currentEngine);

    return {
      engine: currentEngine,
      baseUrl: `http://${HOST}:${config.port}${config.basePath}`,
      model: config.defaultModel,
      defaultVoice: config.defaultVoice,
      availableVoices: voices,
    };
  }

  // Check for external server
  const externalEngine = await detectExternalServer();
  if (externalEngine) {
    const config = ENGINE_CONFIGS[externalEngine];
    const voices = await fetchVoices(externalEngine);

    return {
      engine: externalEngine,
      baseUrl: `http://${HOST}:${config.port}${config.basePath}`,
      model: config.defaultModel,
      defaultVoice: config.defaultVoice,
      availableVoices: voices,
    };
  }

  return null;
};

/**
 * Get the base URL for the current engine
 * Also checks for externally-running servers
 */
export const getCurrentBaseUrl = async (): Promise<string | null> => {
  if (currentEngine) {
    const config = ENGINE_CONFIGS[currentEngine];
    return `http://${HOST}:${config.port}`;
  }

  // Check for external server
  const externalEngine = await detectExternalServer();
  if (externalEngine) {
    const config = ENGINE_CONFIGS[externalEngine];
    return `http://${HOST}:${config.port}`;
  }

  return null;
};

/**
 * Get engine config by ID
 */
export const getEngineConfig = (engine: TTSEngine): TTSEngineConfig => {
  return ENGINE_CONFIGS[engine];
};

// =============================================================================
// Legacy Compatibility (for Next.js battlemap API compatibility)
// These functions keep the "orpheus" naming but delegate to Chatterbox
// =============================================================================

export const startOrpheusServer = () => startEngine('chatterbox');
export const stopOrpheusServer = stopCurrentEngine;
export const getOrpheusStatus = async () => {
  const status = await getCurrentStatus();
  const config = ENGINE_CONFIGS.chatterbox;
  return {
    running: status.running,
    ready: status.ready,
    pid: status.pid,
    url: `http://${HOST}:${config.port}`,
  };
};
export const getOrpheusUrl = () => `http://${HOST}:${ENGINE_CONFIGS.chatterbox.port}`;
