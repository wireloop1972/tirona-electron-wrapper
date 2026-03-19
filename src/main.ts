import {
  app,
  BrowserWindow,
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
import { detectNvidiaGpu } from './gpu-detect';
import {
  startServer,
  stopServer,
  getStatus,
  getConfig,
  getBaseUrl,
  fetchVoices,
  isServerInstalled,
  transcribeAudio,
  type TTSGenerationParams,
} from './tts-manager';
import {
  getAssetPackPath,
  getStaticPackPath,
  loadBundledManifest,
  buildBlobLookup,
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

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let steamClient: any = null;

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
  if (!fs.existsSync(videoPath)) {
    console.warn('Splash video not found, skipping to main window');
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

// ─── IPC: TTS ────────────────────────────────────────────────────────────────

ipcMain.handle('tts:gpuAvailable', () => detectNvidiaGpu());

ipcMain.handle('tts:isInstalled', () => isServerInstalled());

ipcMain.handle('tts:start', async () => {
  console.log('[IPC] tts:start');
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

    if (text.length > 300) {
      console.warn(
        `[IPC] Text is ${text.length} chars – Turbo may hallucinate >300`
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
        if (voice && voice !== 'default') {
          body.voice_mode = 'predefined';
          const voiceFile = voice.endsWith('.wav') ? voice : `${voice}.wav`;
          body.predefined_voice_id = voiceFile;
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
        if (voice && voice !== 'default') {
          body.voice = voice.endsWith('.wav') ? voice : `${voice}.wav`;
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
      'tirona-clerk-auth'
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
      const blobMatch = request.url.match(
        /https:\/\/[^/]+\.blob\.vercel-storage\.com\/([^?]+)/
      );

      if (blobMatch) {
        const blobPathname = decodeURIComponent(blobMatch[1]);
        const localPath = lookup.get(blobPathname);

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

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
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

  const gpu = detectNvidiaGpu();
  const installed = isServerInstalled();
  const ttsAvailable =
    process.platform === 'win32' && gpu.available && installed;

  console.log('=== TTS STATUS ===');
  console.log(`  GPU: ${gpu.available ? gpu.gpuName : 'none'}`);
  console.log(`  Server installed: ${installed}`);
  console.log(`  TTS will load: ${ttsAvailable}`);
  console.log('==================');

  await createWindow();

  if (process.env.TTS_TEST !== 'true') {
    createSplashWindow();

    if (ttsAvailable && splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.once('did-finish-load', () => {
        splashWindow?.webContents.send('splash:tts-needed');
      });

      console.log('[Main] Starting TTS server during splash...');
      startServer()
        .then((config) => {
          console.log('[Main] TTS server ready during splash');
          if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.webContents.send('splash:tts-ready');
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tts:ready', config);
          }
        })
        .catch((err) => {
          console.error('[Main] TTS failed to start during splash:', err);
          if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.webContents.send('splash:tts-ready');
          }
        });
    }
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
