import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  shell,
  ipcMain,
  Menu,
  screen,
  session,
  net,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { registerStartupAssets } from './startup-assets';
import {
  startServer,
  stopServer,
  getStatus,
  getConfig,
  getBaseUrl,
  fetchVoices,
  resolvePredefinedVoice,
  isServerInstalled,
  transcribeAudio,
  detectTtsCapability,
  getBundledBackend,
  type TTSGenerationParams,
  type LocalTTSConfig,
} from './tts-manager';
import {
  getAssetPackPath,
  getStaticPackPath,
  loadBundledManifest,
  buildBlobLookup,
  buildSceneLookup,
  serveSceneAsset,
  getMimeType,
  isStaticAssetPath,
  resolveStaticAsset,
} from './asset-sync-manager';

interface AppConfig {
  development: {
    url: string;
  };
  production: {
    url: string;
  };
}

/** Result of the startup config dialog. Null means the player closed it. */
interface StartupChoice {
  ttsEnabled: boolean;
  config: LocalTTSConfig | null;
}

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let startupMenuWindow: BrowserWindow | null = null;
let resolveStartupMenu: ((choice: StartupChoice | null) => void) | null = null;

// Live TTS state owned by the startup dialog's voice check. No persistence:
// the player is asked every launch and the choice lives only in memory.
let startupTtsConfig: LocalTTSConfig | null = null;
let ttsCheckAbort: AbortController | null = null;

// Whether the player opted into Voice Synthesis for this launch. The game is a
// remote web app carrying its own persisted TTS setting, so the shell cannot
// let the renderer decide whether the server runs - this flag is the single
// authority, set once when the startup dialog hands off to the game.
let ttsAllowedThisLaunch = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let steamClient: any = null;

// ─── Main-Process File Logging (packaged builds only) ────────────────────────
// Beta testers can't see the console; without this, GPU-gate decisions and
// server bring-up failures are invisible remotely. Mirrors console output to
// %APPDATA%/Tirona/main.log (truncated at 2 MB on boot).

const setupFileLog = (): void => {
  if (!app.isPackaged) return;
  try {
    const logPath = path.join(app.getPath('userData'), 'main.log');
    try {
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2_000_000) {
        fs.unlinkSync(logPath);
      }
    } catch { /* rotation is best-effort */ }
    const stream = fs.createWriteStream(logPath, { flags: 'a' });
    const fmt = (a: unknown): string =>
      a instanceof Error
        ? (a.stack ?? a.message)
        : typeof a === 'string'
          ? a
          : JSON.stringify(a);
    const wrap =
      (orig: (...args: unknown[]) => void, tag: string) =>
        (...args: unknown[]): void => {
          orig(...args);
          try {
            stream.write(
              `${new Date().toISOString()} ${tag} ` +
              `${args.map(fmt).join(' ')}\n`
            );
          } catch { /* logging must never break the app */ }
        };
    console.log = wrap(console.log.bind(console), 'LOG');
    console.warn = wrap(console.warn.bind(console), 'WRN');
    console.error = wrap(console.error.bind(console), 'ERR');
    stream.write(
      `\n===== ${new Date().toISOString()} app start ` +
      `(v${app.getVersion()}) =====\n`
    );
  } catch { /* logging must never break startup */ }
};
setupFileLog();

const initSteam = (): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const steamworks = require('steamworks.js');
    steamClient = steamworks.init(4503860);
    app.commandLine.appendSwitch('in-process-gpu');
    app.commandLine.appendSwitch('disable-direct-composition');
    console.log(
      '[Steam] Initialized. User:',
      steamClient.localplayer.getName()
    );
  } catch (e) {
    console.error('[Steam] Failed to init:', e);
    if (app.isPackaged && isSteamBuild()) {
      dialog.showErrorBox(
        'Tirona Rebirth',
        'Please launch the game from your Steam library.'
      );
      app.quit();
    }
  }
};

const getIconPath = (): string | undefined => {
  const candidates = [
    path.join(__dirname, '..', 'assets', 'icon.ico'),
    path.join(__dirname, '..', 'assets', 'icons', 'win', 'icon.ico'),
    path.join(__dirname, '..', 'assets', 'tironaicon.png'),
    path.join(
      path.dirname(process.execPath), 'resources', 'assets', 'icon.ico'
    ),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
};

const FALLBACK_PROD_URL = 'https://tironabattlemap.vercel.app';

const loadConfig = (): AppConfig => {
  const candidates = [
    path.join(__dirname, '..', 'config.json'),
    path.join(path.dirname(process.execPath), 'config.json'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const data = fs.readFileSync(candidate, 'utf-8');
        console.log(`[Main] Loaded config from ${candidate}`);
        return JSON.parse(data);
      }
    } catch (err) {
      console.error(`[Main] Failed to read config at ${candidate}:`, err);
    }
  }

  console.warn('[Main] config.json not found, using hardcoded fallback');
  return {
    development: { url: 'http://localhost:3000' },
    production: { url: FALLBACK_PROD_URL },
  };
};

const getAppUrl = (): string => {
  const config = loadConfig();
  const appEnv = process.env.APP_ENV;

  if (appEnv === 'dev') {
    console.log('[Main] APP_ENV=dev -> Loading development URL');
    return config.development.url;
  }
  if (appEnv === 'prod') {
    console.log('[Main] APP_ENV=prod -> Loading production URL');
    return config.production.url;
  }

  const isPackaged = app.isPackaged;
  console.log(`[Main] APP_ENV not set, isPackaged=${isPackaged} fallback`);
  return isPackaged ? config.production.url : config.development.url;
};

const waitForServer = async (
  url: string,
  maxAttempts = 30
): Promise<boolean> => {
  console.log(`Waiting for server at ${url}...`);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`Server ready after ${i + 1} attempt(s)`);
        return true;
      }
    } catch {
      console.log(`Attempt ${i + 1}/${maxAttempts}: Server not ready yet...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.error('Server did not become ready in time');
  return false;
};

// ─── Splash ──────────────────────────────────────────────────────────────────

const createSplashWindow = (): void => {
  splashWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    title: 'Tirona Rebirth',
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'splash-preload.js'),
    },
  });

  splashWindow.setMenu(null);

  const videoPath = path.join(__dirname, '..', 'assets', 'TironaFading.mp4');
  // With no intro video there is nothing for the splash to show - go
  // straight to the game.
  if (!fs.existsSync(videoPath)) {
    console.warn('No splash video - skipping to main window');
    splashWindow.close();
    showMainWindow();
    return;
  }

  splashWindow.loadFile(
    path.join(__dirname, '..', 'src', 'splash.html')
  );
  splashWindow.on('closed', () => { splashWindow = null; });
};

const showConnectionError = (
  url: string,
  errorCode: number,
  errorDescription: string
): void => {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tirona Rebirth – Connection Error</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0a0f;
    color: #e0ddd5;
    font-family: 'Segoe UI', Tahoma, Geneva, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    -webkit-app-region: drag;
  }
  .card {
    text-align: center;
    max-width: 520px;
    padding: 48px 40px;
    -webkit-app-region: no-drag;
  }
  h1 {
    font-size: 22px;
    font-weight: 600;
    margin-bottom: 16px;
    color: #c9a96e;
  }
  p { font-size: 14px; line-height: 1.6; margin-bottom: 12px; }
  .code {
    font-size: 12px;
    color: #888;
    margin-bottom: 24px;
    font-family: 'Consolas', monospace;
  }
  button {
    background: #c9a96e;
    color: #0a0a0f;
    border: none;
    padding: 12px 36px;
    font-size: 15px;
    font-weight: 600;
    border-radius: 6px;
    cursor: pointer;
    transition: opacity .15s;
  }
  button:hover { opacity: .85; }
  .tips {
    margin-top: 28px;
    text-align: left;
    font-size: 13px;
    color: #999;
  }
  .tips li { margin-bottom: 6px; }
</style>
</head>
<body>
<div class="card">
  <h1>Unable to reach the game server</h1>
  <p>Tirona Rebirth could not connect to the online server after several
  attempts. This is usually temporary.</p>
  <p class="code">Error ${errorCode}: ${errorDescription}</p>
  <button onclick="window.location.href='${url}'">Retry</button>
  <ul class="tips">
    <li>Check your internet connection</li>
    <li>The game server may be undergoing maintenance</li>
    <li>Try again in a few minutes</li>
    <li>If the problem persists, visit our Discord for support</li>
  </ul>
</div>
</body>
</html>`.trim();

  mainWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  );
  if (!mainWindow.isVisible()) mainWindow.show();
};

// ─── Main Window ─────────────────────────────────────────────────────────────

const createWindow = async (): Promise<void> => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    resizable: true,
    fullscreen: false,
    fullscreenable: true,
    title: 'Tirona Rebirth',
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: 'persist:main',
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  mainWindow.maximize();
  mainWindow.setMenu(null);

  const useTTSTest = process.env.TTS_TEST === 'true';
  const appEnv = process.env.APP_ENV || (app.isPackaged ? 'prod' : 'dev');

  const startUrl = useTTSTest
    ? `file://${path.join(__dirname, '..', 'test-electron-tts.html')}`
    : getAppUrl();

  console.log(`Loading application from: ${startUrl}`);
  console.log(`Mode: APP_ENV=${appEnv}${useTTSTest ? ' (TTS TEST)' : ''}`);

  if (appEnv === 'dev' && !useTTSTest && !startUrl.startsWith('file://')) {
    const serverReady = await waitForServer(startUrl);
    if (!serverReady) {
      console.error(
        'Next.js dev server did not start. Please ensure it is running.'
      );
    }
  }

  let loadRetries = 0;
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 3000;

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription) => {
      console.error(`Failed to load: ${errorCode} - ${errorDescription}`);
      if (startUrl.startsWith('file://')) return;

      if (errorCode === -3) return;

      if (loadRetries < MAX_RETRIES) {
        loadRetries++;
        console.log(
          `Retrying (${loadRetries}/${MAX_RETRIES}) in ` +
          `${RETRY_DELAY_MS / 1000}s...`
        );
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL(startUrl);
          }
        }, RETRY_DELAY_MS);
      } else {
        console.error('All retries exhausted, showing error page');
        showConnectionError(startUrl, errorCode, errorDescription);
      }
    }
  );

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page fully loaded');
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('RENDERER CRASHED:', details.reason, details.exitCode);
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.error('RENDERER UNRESPONSIVE');
  });

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    const names = ['debug', 'info', 'warn', 'error'];
    if (level >= 2) {
      console.log(`[Renderer ${names[level] || level}] ${message}`);
    }
  });

  if (startUrl.startsWith('file://')) {
    mainWindow.loadFile(startUrl.replace('file://', ''));
  } else {
    mainWindow.loadURL(startUrl);
  }

  mainWindow.once('ready-to-show', () => {
    const isTTSTest = process.env.TTS_TEST === 'true';
    if (!splashWindow || isTTSTest) {
      mainWindow?.show();
      if (!app.isPackaged && (isTTSTest || appEnv === 'dev')) {
        mainWindow?.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const startUrlOrigin = new URL(startUrl).origin;
    const oauthDomains = [
      'accounts.google.com',
      'github.com',
      'clerk.',
      'vercel.app',
      'tironabattlemap.vercel.app',
    ];

    const isOAuth = oauthDomains.some(d => url.includes(d));
    const isSameOrigin = new URL(url).origin === startUrlOrigin;

    if (isOAuth || isSameOrigin) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 600,
          height: 700,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: 'persist:main',
          },
        },
      };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const startUrlOrigin = new URL(startUrl).origin;
    const targetOrigin = new URL(url).origin;
    const allowed = [
      'clerk.',
      'accounts.google.com',
      'github.com',
      'vercel.app',
      'tironabattlemap.vercel.app',
    ];
    if (
      allowed.some(d => url.includes(d)) ||
      targetOrigin === startUrlOrigin
    ) {
      return;
    }
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
};

const showMainWindow = (): void => {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  if (mainWindow && !mainWindow.isDestroyed()) {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('splash-finished-notify');
      }
    }, 500);
  }
};

// ─── Startup Configuration Menu ──────────────────────────────────────────────

/**
 * Shows the pre-game configuration window (Voice Synthesis opt-in) and
 * resolves once the player clicks Launch Game. Asked every launch — the
 * choice is never persisted and Voice Synthesis is off by default.
 *
 * Resolves with the player's choice (including the live TTS config when the
 * voice check ran inside the dialog, so the server is not restarted), or
 * null when the window was closed without launching.
 *
 * The window is NOT closed here on launch: the caller closes it after the
 * game/splash windows exist, so the app never hits a zero-window state
 * (which would fire window-all-closed and quit).
 */
const showStartupMenu = (): Promise<StartupChoice | null> => {
  return new Promise((resolve) => {
    resolveStartupMenu = resolve;

    // A wide study-and-book composition; the compact layout fits 900x600.
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const w = Math.min(1440, width);
    const h = Math.min(900, height);

    startupMenuWindow = new BrowserWindow({
      width: w,
      height: h,
      minWidth: Math.min(900, width),
      minHeight: Math.min(600, height),
      x: Math.floor((width - w) / 2),
      y: Math.floor((height - h) / 2),
      frame: false,
      resizable: true,
      backgroundColor: '#0d0b08',
      title: 'Tirona Rebirth',
      icon: getIconPath(),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'startup-menu-preload.js'),
      },
      show: false,
    });

    startupMenuWindow.setMenu(null);
    startupMenuWindow.loadFile(
      path.join(__dirname, '..', 'src', 'startup-menu.html')
    );

    startupMenuWindow.once('ready-to-show', () => {
      startupMenuWindow?.show();
      startupMenuWindow?.focus();
    });

    startupMenuWindow.on('closed', () => {
      startupMenuWindow = null;
      // Abort any in-flight voice check; its events have nowhere to go.
      ttsCheckAbort?.abort();
      ttsCheckAbort = null;
      // Closed without launching -> resolve null (the app will quit via
      // window-all-closed once this was the last window).
      if (resolveStartupMenu) {
        const r = resolveStartupMenu;
        resolveStartupMenu = null;
        r(null);
      }
    });
  });
};

const closeStartupMenu = (): void => {
  if (startupMenuWindow && !startupMenuWindow.isDestroyed()) {
    startupMenuWindow.close();
  }
};

const setupDeepLinking = (): void => {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('tirona', process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient('tirona');
  }
};

// Auto-updater
import { setupAutoUpdater, cleanupAutoUpdater } from './updater';

// ─── IPC: Splash & Window ────────────────────────────────────────────────────

ipcMain.on('splash-finished', () => showMainWindow());

ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.isMaximized()
      ? mainWindow.unmaximize()
      : mainWindow.maximize();
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

ipcMain.handle('window:isMaximized', () =>
  mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false
);

ipcMain.on('window:toggleFullscreen', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

ipcMain.handle('window:isFullscreen', () =>
  mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFullScreen() : false
);

ipcMain.on('window:setSize', (_e, w: number, h: number) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSize(w, h);
    mainWindow.center();
  }
});

ipcMain.handle('window:getSize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [width, height] = mainWindow.getSize();
    return { width, height };
  }
  return { width: 0, height: 0 };
});

ipcMain.on('settings:open', () => {
  console.log('[Main] Settings panel requested');
});

// ─── IPC: Startup Menu ───────────────────────────────────────────────────────

ipcMain.handle('startup:get-info', () => {
  const cap = detectTtsCapability();
  const serverInstalled = isServerInstalled();
  return {
    gpu: cap.gpu,
    backend: cap.backend,
    serverInstalled,
    ttsSupported:
      process.platform === 'win32' && cap.supported && serverInstalled,
  };
});

const shortReason = (err: unknown): string => {
  let msg = err instanceof Error ? err.message : String(err);
  msg = msg.replace(/\s+/g, ' ').trim();
  return msg.length > 120 ? `${msg.slice(0, 117)}…` : msg;
};

/**
 * Orchestrates the full Voice Synthesis bring-up triggered by the dialog
 * toggle: GPU check -> spawn server -> model load (health poll) -> generate
 * the Narrator intro line. Progress and the final result are pushed to the
 * dialog renderer; the renderer plays the audio and reports back when it
 * ends. On success the server stays warm for in-game use.
 */
const runTtsCheck = async (): Promise<void> => {
  const win = startupMenuWindow;
  if (!win || win.isDestroyed()) return;
  if (ttsCheckAbort) {
    console.warn('[Startup] TTS check already running, ignoring');
    return;
  }

  const abort = new AbortController();
  ttsCheckAbort = abort;
  startupTtsConfig = null;

  const t0 = Date.now();
  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const progress = (
    phase: 'gpu' | 'spawn' | 'load' | 'generate' | 'play'
  ): void =>
    send('startup:ttsProgress', { phase, elapsedMs: Date.now() - t0 });
  // Model load is the long pole of bring-up and its length depends entirely
  // on the GPU, so the dialog shows live engine output next to the progress
  // bar: real evidence of work rather than a bar that just sits there.
  const logLine = (line: string): void => {
    if (abort.signal.aborted) return;
    send('startup:ttsLog', { line, elapsedMs: Date.now() - t0 });
  };

  try {
    progress('gpu');
    const cap = detectTtsCapability();
    if (!cap.supported) {
      throw new Error(cap.reason ?? 'no compatible GPU');
    }
    if (!isServerInstalled()) throw new Error('voice engine not installed');

    progress('spawn');
    const spawnedAt = Date.now();
    const config = await startServer({
      signal: abort.signal,
      onSpawned: () => progress('load'),
      onLog: logLine,
    });
    const modelLoadMs = Date.now() - spawnedAt;
    if (abort.signal.aborted) throw new Error('cancelled');

    progress('generate');
    // Warm up + audibly test with the narrator voice specifically, so swapping
    // the Narrator voice file later automatically changes what the test plays.
    const intro = await generateNarratorIntro('narrator', abort.signal);
    if (abort.signal.aborted) throw new Error('cancelled');
    if (!intro.audioDataUrl) {
      throw new Error(intro.error ?? 'voice generation failed');
    }

    progress('play');
    startupTtsConfig = config;
    console.log(
      `[Startup] TTS check OK - model load ${modelLoadMs}ms, ` +
      `first audio ${intro.firstAudioMs}ms`
    );
    send('startup:ttsResult', {
      success: true,
      metrics: { modelLoadMs, firstAudioMs: intro.firstAudioMs },
      audioDataUrl: intro.audioDataUrl,
    });
  } catch (err) {
    stopServer();
    startupTtsConfig = null;
    if (!abort.signal.aborted) {
      console.error('[Startup] TTS check failed:', err);
      let reason = shortReason(err);
      if (getBundledBackend() === 'rocm') {
        // Most AMD bring-up failures trace to the driver floor for the
        // ROCm-on-Windows preview wheels; give the tester the fix inline.
        reason += ' — AMD builds need Adrenalin driver 26.2.2 or newer';
      }
      send('startup:ttsResult', { success: false, reason });
    }
  } finally {
    if (ttsCheckAbort === abort) ttsCheckAbort = null;
  }
};

ipcMain.handle('startup:beginTtsCheck', () => {
  void runTtsCheck();
});

// Cancel covers three cases: abort an in-flight check, stop playback-phase
// bring-up, and shut the warm server down when the player flips the toggle
// back to Off after a successful check.
ipcMain.handle('startup:cancelTtsCheck', () => {
  ttsCheckAbort?.abort();
  ttsCheckAbort = null;
  startupTtsConfig = null;
  stopServer();
});

ipcMain.handle(
  'startup:reportAudioFinished',
  (_e, audioDurationMs: number) => {
    console.log(
      `[Startup] Narrator test playback finished ` +
      `(${Math.round(audioDurationMs)}ms of audio)`
    );
    return { ok: true };
  }
);

// The launcher window is frameless and draws its own controls in the strap.
ipcMain.on('startup:minimize', () => {
  if (startupMenuWindow && !startupMenuWindow.isDestroyed()) {
    startupMenuWindow.minimize();
  }
});

// Closing the launcher is closing the app: the 'closed' handler resolves the
// startup promise with null and window-all-closed takes it from there.
ipcMain.on('startup:close', () => {
  if (startupMenuWindow && !startupMenuWindow.isDestroyed()) {
    startupMenuWindow.close();
  }
});

// Raw voice-server output, offered from the failure state only. It belongs on
// the clipboard for support, not on screen in a player-facing surface.
ipcMain.on('startup:copyDiagnostics', (_e, text: string) => {
  const body = typeof text === 'string' ? text : '';
  clipboard.writeText(
    `Tirona voice bring-up diagnostics\n` +
    `backend: ${getBundledBackend()}\n` +
    `platform: ${process.platform} ${process.arch}\n` +
    `app: ${app.getVersion()}\n\n${body}`
  );
});

ipcMain.handle('startup:launchGame', () => {
  // Defensive: Begin should be unreachable while the load modal is up, but if
  // a check is somehow still running, treat launching as cancelling it.
  if (ttsCheckAbort) {
    ttsCheckAbort.abort();
    ttsCheckAbort = null;
    startupTtsConfig = null;
    stopServer();
  }
  ttsAllowedThisLaunch = startupTtsConfig !== null;
  if (resolveStartupMenu) {
    const r = resolveStartupMenu;
    resolveStartupMenu = null;
    r({ ttsEnabled: startupTtsConfig !== null, config: startupTtsConfig });
  }
  return { ok: true };
});

// ─── IPC: TTS ────────────────────────────────────────────────────────────────

ipcMain.handle('tts:gpuAvailable', () => detectTtsCapability().gpu);

ipcMain.handle('tts:isInstalled', () => isServerInstalled());

ipcMain.handle('tts:start', async () => {
  console.log('[IPC] tts:start');
  // The player declined Voice Synthesis in the startup dialog (or never saw
  // it). Refuse rather than spawn: the game's own persisted TTS setting must
  // not be able to bring the server up behind the player's back. Null reads
  // as "no config" on the renderer side, i.e. TTS unavailable this session.
  if (!ttsAllowedThisLaunch) {
    console.log('[IPC] tts:start refused - Voice Synthesis off for this launch');
    return null;
  }
  try {
    const config = await startServer();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tts:ready', config);
    }
    return config;
  } catch (err) {
    console.error('[IPC] tts:start failed:', err);
    throw err;
  }
});

ipcMain.handle('tts:stop', () => {
  console.log('[IPC] tts:stop');
  stopServer();
  return { success: true };
});

ipcMain.handle('tts:getConfig', () => getConfig());
ipcMain.handle('tts:getStatus', () => getStatus());

ipcMain.handle('tts:getVoices', async () => {
  const status = await getStatus();
  if (!status.ready) return { voices: [], error: 'TTS server not running' };
  try {
    const voices = await fetchVoices();
    return { voices };
  } catch (err) {
    return { voices: [], error: String(err) };
  }
});

ipcMain.handle(
  'tts:speak',
  async (
    _event,
    text: string,
    voice: string,
    params?: TTSGenerationParams
  ) => {
    console.log(
      `[IPC] tts:speak – voice=${voice}, len=${text?.length ?? 0}`
    );

    if (!text || text.length === 0) {
      return { success: false, error: 'Empty text' };
    }

    const baseUrl = await getBaseUrl();
    if (!baseUrl) {
      return { success: false, error: 'TTS server not running' };
    }

    // Turbo decodes at most max_gen_len=1000 speech tokens (t3.py inference_turbo)
    // and S3_TOKEN_RATE is 25/s, so ~40s of audio is the hard ceiling: past it the
    // waveform simply stops mid-sentence and the tail is lost silently. Measured
    // ~16.3 chars per second of speech, so ~650 chars. Warn with margin. (The old
    // ">300 chars may hallucinate" note was folklore from the original model.)
    if (text.length > 600) {
      console.warn(
        `[IPC] Text is ${text.length} chars – Turbo caps at ~40s of audio ` +
        `(~650 chars); the tail may be cut`
      );
    }

    // Map the renderer's voice name ('narrator', 'Bodin', 'Malineth', …) to the
    // exact predefined-voice filename Chatterbox expects ('Narrator.wav',
    // 'Bodin.mp3', …). Case-insensitive, extension-agnostic, with a narrator
    // fallback so an unknown name never 404s. Both endpoints match a voice by
    // exact filename, so this must run for the /tts and /v1/audio/speech paths.
    const resolvedVoice = await resolvePredefinedVoice(voice);
    if (resolvedVoice && resolvedVoice !== voice) {
      console.log(`[IPC] tts:speak – voice '${voice}' -> '${resolvedVoice}'`);
    } else if (!resolvedVoice) {
      console.warn(
        `[IPC] tts:speak – server reports no predefined voices; ` +
        `request for '${voice}' will likely fail`
      );
    }

    try {
      const hasParams =
        params &&
        (params.exaggeration !== undefined ||
          params.cfgWeight !== undefined ||
          params.temperature !== undefined ||
          params.speedFactor !== undefined ||
          params.seed !== undefined);

      let response: Response;

      if (hasParams) {
        const body: Record<string, unknown> = { text };
        if (resolvedVoice) {
          body.voice_mode = 'predefined';
          body.predefined_voice_id = resolvedVoice;
        }
        body.output_format = 'wav';
        if (params.exaggeration !== undefined)
          body.exaggeration = params.exaggeration;
        if (params.cfgWeight !== undefined)
          body.cfg_weight = params.cfgWeight;
        if (params.temperature !== undefined)
          body.temperature = params.temperature;
        if (params.speedFactor !== undefined)
          body.speed_factor = params.speedFactor;
        if (params.seed !== undefined && params.seed >= 0)
          body.seed = params.seed;

        response = await fetch(`${baseUrl}/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        const body: Record<string, string> = {
          model: 'turbo',
          input: text,
          response_format: 'wav',
        };
        if (resolvedVoice) {
          body.voice = resolvedVoice;
        }

        response = await fetch(`${baseUrl}/v1/audio/speech`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error(
          `[IPC] TTS HTTP ${response.status}: ${errBody}`
        );
        return { success: false, error: `HTTP ${response.status}: ${errBody}` };
      }

      const arrayBuffer = await response.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      console.log(`[IPC] Received ${buf.length} bytes of audio`);

      const dataUrl = `data:audio/wav;base64,${buf.toString('base64')}`;
      return { success: true, audioUrl: dataUrl };
    } catch (err) {
      console.error('[IPC] tts:speak error:', err);
      return { success: false, error: String(err) };
    }
  }
);

// ─── IPC: STT ────────────────────────────────────────────────────────────────

ipcMain.handle(
  'stt:transcribe',
  async (_event, audioData: ArrayBuffer) => {
    console.log(
      `[IPC] stt:transcribe – ${audioData?.byteLength ?? 0} bytes`
    );

    const baseUrl = await getBaseUrl();
    if (!baseUrl) {
      return { success: false, error: 'Python server not running' };
    }

    try {
      const result = await transcribeAudio(
        Buffer.from(audioData),
        'recording.webm'
      );
      console.log(
        `[IPC] STT result: "${result.text}" ` +
        `(${result.duration?.toFixed(1)}s)`
      );
      return {
        success: true,
        text: result.text,
        language: result.language,
        duration: result.duration,
      };
    } catch (err) {
      console.error('[IPC] stt:transcribe error:', err);
      return { success: false, error: String(err) };
    }
  }
);

// ─── IPC: Steam Auth ──────────────────────────────────────────────────────

ipcMain.handle('steam:isAvailable', () => !!steamClient);

ipcMain.handle('steam:getAuthTicket', async () => {
  if (!steamClient) return null;

  try {
    const sid = steamClient.localplayer.getSteamId();
    const steamId64 = sid.steamId64.toString();
    console.log('[Steam] SteamID64:', steamId64);

    const ticket = await steamClient.auth.getAuthTicketForWebApi(
      'tirona-supabase-auth'
    );
    const ticketHex = Buffer.from(ticket.getBytes()).toString('hex');
    console.log('[Steam] Got auth ticket, length:', ticketHex.length);

    return {
      ticket: ticketHex,
      steamId64,
    };
  } catch (err) {
    console.error('[Steam] Failed to get auth ticket:', err);
    return null;
  }
});

// ─── Steam Detection ─────────────────────────────────────────────────────────

const isSteamBuild = (): boolean => {
  if (!app.isPackaged) return false;
  if (process.env.SteamAppId || process.env.SteamGameId) return true;
  const exeDir = path.dirname(process.execPath);
  const steamDll = path.join(exeDir, 'steam_api64.dll');
  const steamTxt = path.join(exeDir, 'steam_appid.txt');
  return fs.existsSync(steamDll) || fs.existsSync(steamTxt);
};

// ─── Local Asset Interceptor ────────────────────────────────────────────────

let interceptorAssetCount = 0;
let interceptorStaticReady = false;

const registerAssetInterceptor = (): void => {
  const assetPackDir = getAssetPackPath();
  const staticPackDir = getStaticPackPath();
  const appUrl = getAppUrl().replace(/\/$/, '');

  const manifest = loadBundledManifest(assetPackDir);
  const lookup = manifest
    ? buildBlobLookup(manifest, assetPackDir)
    : new Map<string, string>();
  interceptorAssetCount = lookup.size;
  const sceneLookup = manifest ? buildSceneLookup(manifest, assetPackDir) : new Map<string, string>();

  interceptorStaticReady = fs.existsSync(staticPackDir);

  if (interceptorAssetCount === 0 && !interceptorStaticReady) {
    console.log(
      '[Interceptor] No asset-pack or static-pack found, skipping'
    );
    return;
  }

  const ses = session.fromPartition('persist:main');

  ses.protocol.handle('https', async (request: Request) => {
    try {
      const sceneResponse = serveSceneAsset(request.url, appUrl, sceneLookup);
      if (sceneResponse) return sceneResponse;
      const blobMatch = request.url.match(
        /https:\/\/[^/]+\.blob\.vercel-storage\.com\/([^?]+)/
      );

      if (blobMatch) {
        const blobPathname = decodeURIComponent(blobMatch[1]);
        const localPath = lookup.get(blobPathname);

        // A known packaged file missing on disk means a damaged installation.
        // An unknown immutable URL is a new release asset: allow Blob fallback
        // so the web asset sync can persist it in its existing cache.
        if (blobPathname.startsWith('assets/scenes/') && localPath && !fs.existsSync(localPath)) {
          console.error(`[ScenePack] Missing installed Blob asset: ${blobPathname}`);
          return new Response('Required scene asset missing; verify Steam installation.', { status: 503 });
        }

        if (localPath && fs.existsSync(localPath)) {
          console.log(`[Interceptor] Blob hit: ${blobPathname}`);
          const data = fs.readFileSync(localPath);
          return new Response(data, {
            status: 200,
            headers: { 'Content-Type': getMimeType(localPath) },
          });
        }
      }

      if (interceptorStaticReady && request.url.startsWith(appUrl)) {
        const urlPath = new URL(request.url).pathname;
        if (isStaticAssetPath(urlPath)) {
          const localPath = resolveStaticAsset(staticPackDir, urlPath);
          if (localPath) {
            console.log(`[Interceptor] Static hit: ${urlPath}`);
            const data = fs.readFileSync(localPath);
            return new Response(data, {
              status: 200,
              headers: { 'Content-Type': getMimeType(localPath) },
            });
          }
        }
      }
    } catch (err) {
      console.error('[Interceptor] Error serving local asset:', err);
    }

    return net.fetch(request, {
      bypassCustomProtocolHandlers: true,
    });
  });

  const parts: string[] = [];
  if (interceptorAssetCount > 0) {
    parts.push(
      `${lookup.size} blob assets` +
      (manifest ? ` (pack v${manifest.assetPackVersion})` : '')
    );
  }
  if (interceptorStaticReady) {
    parts.push('static-pack');
  }
  console.log(`[Interceptor] Registered – ${parts.join(' + ')}`);
};

// ─── Narrator Intro (TTS warm-up + test) ─────────────────────────────────────

const NARRATOR_INTRO_TEXT =
  'Can you hear me? … Good. I am the Narrator. If it took me an awkwardly ' +
  'long time to arrive, you might want to mute me entirely—or consider ' +
  'upgrading that relic you call a graphics card. Either way, we’ll manage. ' +
  'Welcome to Tirona, where your choices matter, your luck is questionable, ' +
  'and I will be with you every step of the way. Let’s begin.';

interface NarratorIntroResult {
  audioDataUrl: string | null;
  /** Time from POST sent to full HTTP response received. */
  firstAudioMs: number;
  error?: string;
}

/**
 * Generates the Narrator intro line. This is the first TTS request after the
 * model loads: it warms up Chatterbox (the first generation compiles CUDA
 * kernels) and serves as an audible test for the player.
 */
const generateNarratorIntro = async (
  voice: string,
  signal?: AbortSignal
): Promise<NarratorIntroResult> => {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) {
    return {
      audioDataUrl: null,
      firstAudioMs: 0,
      error: 'voice server not running',
    };
  }

  // Combine the caller's cancel signal with a 120s generation timeout.
  // (AbortSignal.any is not guaranteed on this Node, so combine manually.)
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new Error('generation timed out')),
    120_000
  );
  const onAbort = (): void => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctrl.abort();

  const t0 = Date.now();
  try {
    // The /v1/audio/speech endpoint requires a real predefined voice file;
    // there is no server-side default. Resolve the requested name to an exact
    // filename ('narrator' -> 'Narrator.wav'), falling back to any voice.
    const voiceFile = await resolvePredefinedVoice(voice);
    if (!voiceFile) {
      return {
        audioDataUrl: null,
        firstAudioMs: 0,
        error: 'no predefined voices installed on the voice server',
      };
    }

    const body: Record<string, string> = {
      model: 'turbo',
      input: NARRATOR_INTRO_TEXT,
      response_format: 'wav',
      voice: voiceFile,
    };

    console.log(
      `[Narrator] Generating intro line (warm-up + test, voice=${voiceFile})...`
    );
    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error(`[Narrator] HTTP ${response.status}: ${errBody}`);
      return {
        audioDataUrl: null,
        firstAudioMs: 0,
        error: `voice test failed (HTTP ${response.status})`,
      };
    }

    const buf = Buffer.from(await response.arrayBuffer());
    const firstAudioMs = Date.now() - t0;
    console.log(
      `[Narrator] Intro generated – ${buf.length} bytes in ${firstAudioMs}ms`
    );
    return {
      audioDataUrl: `data:audio/wav;base64,${buf.toString('base64')}`,
      firstAudioMs,
    };
  } catch (err) {
    console.error('[Narrator] Failed to generate intro:', err);
    return {
      audioDataUrl: null,
      firstAudioMs: 0,
      error: signal?.aborted ? 'cancelled' : shortReason(err),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  registerStartupAssets();
  Menu.setApplicationMenu(null);
  setupDeepLinking();
  initSteam();

  const steam = isSteamBuild();
  console.log(`[Main] Steam build: ${steam}`);

  registerAssetInterceptor();
  if (interceptorAssetCount > 0 || interceptorStaticReady) {
    console.log(
      `[Main] Asset interceptor active` +
      ` (${interceptorAssetCount} blob, static=${interceptorStaticReady})`
    );
  }

  const cap = detectTtsCapability();
  const installed = isServerInstalled();
  const ttsAvailable =
    process.platform === 'win32' && cap.supported && installed;

  console.log('=== TTS STATUS ===');
  console.log(`  Backend: ${cap.backend ?? 'none'}`);
  console.log(
    `  GPU: ${cap.gpu.available ? cap.gpu.gpuName : `none (${cap.reason})`}`
  );
  console.log(`  Server installed: ${installed}`);
  console.log(`  TTS available: ${ttsAvailable}`);
  console.log('==================');

  if (process.env.TTS_TEST === 'true') {
    // The test harness skips the startup dialog, so grant TTS explicitly or
    // its tts:start calls would be refused by the gate above.
    ttsAllowedThisLaunch = true;
    await createWindow();
  } else {
    // Pre-game configuration: nothing else opens until the player clicks
    // Launch Game. Voice Synthesis is off by default, asked every launch.
    // If the player turned it on, the warm-up + audible test already ran
    // inside the dialog and the server is warm.
    const choice = await showStartupMenu();
    if (!choice) {
      // Dialog closed without launching: the app quits via
      // window-all-closed. Do not create any windows.
      console.log('[Main] Startup menu closed without launching - exiting');
      return;
    }
    console.log(
      `[Main] Launching game - Voice Synthesis ${
        choice.ttsEnabled ? 'ENABLED (server warm)' : 'disabled'
      }`
    );

    await createWindow();

    if (choice.config && mainWindow && !mainWindow.isDestroyed()) {
      const config = choice.config;
      mainWindow.webContents.once('did-finish-load', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tts:ready', config);
        }
      });
    }

    createSplashWindow();
    // Close the config dialog only now that the game/splash windows exist,
    // so the app never hits a zero-window state (window-all-closed quits).
    closeStartupMenu();
  }

  // Steam handles its own updates; only use electron-updater for
  // non-Steam packaged builds (e.g. direct GitHub Releases).
  if (app.isPackaged && !steam) {
    console.log('Starting auto-updater...');
    setupAutoUpdater();
  } else {
    console.log(
      steam
        ? 'Auto-updater disabled (Steam build)'
        : 'Auto-updater disabled in development'
    );
  }
});

app.on('window-all-closed', () => {
  cleanupAutoUpdater();
  stopServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) await createWindow();
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  console.log('Deep link received:', url);

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();

    if (url.startsWith('tirona://')) {
      const config = loadConfig();
      const baseUrl = app.isPackaged
        ? config.production.url
        : config.development.url;
      const urlObj = new URL(url);
      const callbackUrl = `${baseUrl}${urlObj.pathname}${urlObj.search}`;
      console.log('Navigating to:', callbackUrl);
      mainWindow.webContents.executeJavaScript(
        `window.location.href = '${callbackUrl}';`
      );
    } else {
      mainWindow.loadURL(url);
    }
  }
});

app.on('will-quit', () => {
  console.log('Application shutting down...');
  stopServer();
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
