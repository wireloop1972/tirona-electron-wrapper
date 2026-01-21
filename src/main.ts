import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  Menu,
  protocol,
  net,
  screen,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  // New unified TTS manager
  type TTSEngine,
  getInstalledEngines,
  startEngine,
  stopCurrentEngine,
  getCurrentStatus,
  getCurrentConfig,
  getCurrentBaseUrl,
  fetchVoices,
  // Legacy Orpheus compatibility
  getOrpheusStatus,
  getOrpheusUrl,
} from './tts-manager';

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

/**
 * Loads the application configuration from config.json
 */
const loadConfig = (): AppConfig => {
  const configPath = path.join(__dirname, '..', 'config.json');
  const configData = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(configData);
};

/**
 * Get the application URL based on APP_ENV environment variable
 * - APP_ENV=dev  → localhost:3000 (Next.js dev server)
 * - APP_ENV=prod → Vercel production URL
 * - Default: Uses app.isPackaged fallback for backwards compatibility
 */
const getAppUrl = (): string => {
  const config = loadConfig();
  const appEnv = process.env.APP_ENV;
  
  // If APP_ENV is explicitly set, use it
  if (appEnv === 'dev') {
    console.log('[Main] APP_ENV=dev → Loading development URL');
    return config.development.url;
  }
  if (appEnv === 'prod') {
    console.log('[Main] APP_ENV=prod → Loading production URL');
    return config.production.url;
  }
  
  // Fallback: Use app.isPackaged for backwards compatibility
  const isPackaged = app.isPackaged;
  console.log(`[Main] APP_ENV not set, using isPackaged=${isPackaged} fallback`);
  return isPackaged ? config.production.url : config.development.url;
};

/**
 * Wait for Next.js dev server to be ready
 * Attempts to connect to the server before loading the window
 */
const waitForServer = async (
  url: string, 
  maxAttempts: number = 30
): Promise<boolean> => {
  console.log(`Waiting for server at ${url}...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`Server ready after ${i + 1} attempt(s)`);
        return true;
      }
    } catch (error) {
      console.log(`Attempt ${i + 1}/${maxAttempts}: Server not ready yet...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.error('Server did not become ready in time');
  return false;
};

/**
 * Creates the splash screen window
 */
const createSplashWindow = (): void => {
  splashWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'splash-preload.js'),
    },
  });

  // Remove menu from splash window
  splashWindow.setMenu(null);

  // Check if video file exists
  const videoPath = path.join(__dirname, '..', 'assets', 'TironaFading.mp4');
  const videoExists = fs.existsSync(videoPath);

  if (!videoExists) {
    console.warn('Splash video not found, skipping to main window');
    splashWindow.close();
    showMainWindow();
    return;
  }

  // Load splash HTML (in src folder, one level up from dist)
  const splashPath = path.join(__dirname, '..', 'src', 'splash.html');
  splashWindow.loadFile(splashPath);

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
};

/**
 * Creates the main application window
 * Frameless, maximized window for custom header UI
 */
const createWindow = async (): Promise<void> => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    minWidth: 800,
    minHeight: 600,
    frame: false,           // No OS title bar - custom header in Next.js UI
    resizable: true,
    fullscreen: false,
    fullscreenable: true,
    titleBarStyle: 'hidden', // Fallback for macOS
    webPreferences: {
      // Security: Disable node integration for remote content
      nodeIntegration: false,
      // Security: Enable context isolation
      contextIsolation: true,
      // Allow OAuth flows to work properly
      webSecurity: true,
      // Enable session/cookie persistence for OAuth
      partition: 'persist:main',
      // Preload script for secure IPC communication if needed
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false, // Don't show until splash is finished
  });

  // Maximize the window after creation for proper windowed-fullscreen effect
  mainWindow.maximize();

  // Remove default menu from main window
  mainWindow.setMenu(null);

  // Load the appropriate URL based on APP_ENV environment variable
  const useTTSTest = process.env.TTS_TEST === 'true';
  const appEnv = process.env.APP_ENV || (app.isPackaged ? 'prod' : 'dev');
  
  const startUrl = useTTSTest
    ? `file://${path.join(__dirname, '..', 'test-electron-tts.html')}`
    : getAppUrl();

  console.log(`Loading application from: ${startUrl}`);
  console.log(`Mode: APP_ENV=${appEnv}${useTTSTest ? ' (TTS TEST)' : ''}`);
  
  // In development, wait for server to be ready before loading (but not for local files)
  if (appEnv === 'dev' && !useTTSTest && !startUrl.startsWith('file://')) {
    const serverReady = await waitForServer(startUrl);
    if (!serverReady) {
      console.error('Next.js dev server did not start. Please ensure it is running.');
      // You could show an error dialog here if needed
    }
  }
  
  // Add error handling for load failures
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Failed to load: ${errorCode} - ${errorDescription}`);
    
    // Retry loading after a short delay (common with Next.js dev server)
    // Don't retry for local files or successful cancellations
    if ((errorCode === -3 || errorCode === -6) && !startUrl.startsWith('file://')) { 
      console.log('Retrying load in 2 seconds...');
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(startUrl);
        }
      }, 2000);
    }
  });

  // Wait for the page to fully load (not just ready-to-show)
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page fully loaded');
  });

  // Detect renderer crashes
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('💥 RENDERER CRASHED!');
    console.error('Reason:', details.reason);
    console.error('Exit code:', details.exitCode);
  });

  // Detect when renderer becomes unresponsive
  mainWindow.webContents.on('unresponsive', () => {
    console.error('⚠️ RENDERER UNRESPONSIVE!');
  });

  // Detect console messages from renderer
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    const levelNames = ['debug', 'info', 'warn', 'error'];
    if (level >= 2) { // warn and error
      console.log(`[Renderer ${levelNames[level] || level}] ${message}`);
    }
  });

  // Load the URL (use loadFile for local files)
  if (startUrl.startsWith('file://')) {
    const filePath = startUrl.replace('file://', '');
    mainWindow.loadFile(filePath);
  } else {
    mainWindow.loadURL(startUrl);
  }

  // Don't auto-show - will be shown after splash finishes
  mainWindow.once('ready-to-show', () => {
    // Window is ready but don't show yet if splash is active
    // For TTS test, show immediately (no splash)
    const isTTSTest = process.env.TTS_TEST === 'true';
    if (!splashWindow || isTTSTest) {
      mainWindow?.show();
      // Open DevTools in development for debugging
      if (!app.isPackaged && (isTTSTest || appEnv === 'dev')) {
        mainWindow?.webContents.openDevTools({ mode: 'detach' });
      }
      // Open DevTools for TTS test (legacy check)
      if (isTTSTest && !app.isPackaged) {
        mainWindow?.webContents.openDevTools();
      }
    }
  });

  // DevTools can be opened manually with F12 or Ctrl+Shift+I if needed
  // Uncomment below to auto-open DevTools in development
  // if (!app.isPackaged) {
  //   mainWindow.webContents.openDevTools();
  // }

  // Handle external links and OAuth popups
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const startUrlOrigin = new URL(startUrl).origin;
    
    // Allow OAuth provider URLs (Google, GitHub, etc.) to open in new window
    const oauthDomains = [
      'accounts.google.com',
      'github.com',
      'clerk.',
      'vercel.app',
      'tironabattlemap.vercel.app'
    ];
    
    const isOAuthUrl = oauthDomains.some(domain => url.includes(domain));
    const isSameOrigin = new URL(url).origin === startUrlOrigin;
    
    // Allow OAuth URLs and same-origin URLs to open in app
    if (isOAuthUrl || isSameOrigin) {
      return { 
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 600,
          height: 700,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: 'persist:main', // Share session with main window
          }
        }
      };
    }

    // Other external links open in default browser
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle navigation - allow OAuth flows
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const startUrlOrigin = new URL(startUrl).origin;
    const targetUrlOrigin = new URL(url).origin;

    // OAuth domains that should be allowed to navigate
    const allowedDomains = [
      'clerk.',
      'accounts.google.com',
      'github.com',
      'vercel.app',
      'tironabattlemap.vercel.app'
    ];

    const isAllowedDomain = allowedDomains.some(domain => url.includes(domain));
    const isSameOrigin = targetUrlOrigin === startUrlOrigin;

    // Allow navigation to OAuth providers and same origin
    if (isAllowedDomain || isSameOrigin) {
      return; // Allow navigation
    }

    // For other external URLs, open in browser instead
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

/**
 * Shows the main window and closes splash
 */
const showMainWindow = (): void => {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  
  if (mainWindow) {
    // Add a small delay to ensure the page is fully rendered
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        
        // Notify the renderer that splash has finished
        mainWindow.webContents.send('splash-finished-notify');
      }
    }, 500);
  }
};

/**
 * Configure deep linking for OAuth callbacks (Clerk authentication)
 */
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

// Auto-update implementation
import { setupAutoUpdater, cleanupAutoUpdater } from './updater';

// IPC handlers

// Handle splash screen finish event
ipcMain.on('splash-finished', () => {
  showMainWindow();
});

// Window control IPC handlers for frameless window
ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('window:maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle('window:isMaximized', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.isMaximized();
  }
  return false;
});

// Fullscreen toggle
ipcMain.on('window:toggleFullscreen', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

ipcMain.handle('window:isFullscreen', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.isFullScreen();
  }
  return false;
});

// Window resize control
ipcMain.on('window:setSize', (_event, width: number, height: number) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSize(width, height);
    mainWindow.center(); // Center after resize
  }
});

ipcMain.handle('window:getSize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [width, height] = mainWindow.getSize();
    return { width, height };
  }
  return { width: 0, height: 0 };
});

// Placeholder for settings panel (can be expanded later)
ipcMain.on('settings:open', () => {
  console.log('[Main] Settings panel requested - TODO: implement settings modal');
});

// Legacy Orpheus TTS IPC handlers (for Next.js battlemap API compatibility)
// These keep "orpheus" naming but delegate to Chatterbox via tts-manager.ts

// Handle status requests (legacy API)
ipcMain.handle('orpheus:status', async () => {
  return getOrpheusStatus();
});

// Handle Orpheus start requests (legacy API - delegates to Chatterbox)
ipcMain.handle('orpheus:start', async () => {
  try {
    await startEngine('chatterbox');
    return { success: true };
  } catch (error) {
    console.error('[IPC] Failed to start Chatterbox:', error);
    return { success: false, error: String(error) };
  }
});

// Handle stop requests (legacy API - delegates to tts-manager)
ipcMain.handle('orpheus:stop', () => {
  stopCurrentEngine();
  return { success: true };
});

// Handle voices request (legacy API - proxies to Chatterbox)
ipcMain.handle('orpheus:voices', async () => {
  try {
    // Use the unified status check that detects external servers
    const status = await getCurrentStatus();
    if (!status.engine || !status.ready) {
      console.log('[IPC] orpheus:voices - no TTS server ready');
      return { status: 'ok', voices: [] };
    }
    
    // Fetch voices using the unified fetchVoices function
    const voices = await fetchVoices(status.engine);
    console.log(`[IPC] orpheus:voices - returning ${voices.length} voices from ${status.engine}`);
    return { status: 'ok', voices };
  } catch (error) {
    console.error('[IPC] Failed to get voices:', error);
    return { status: 'error', error: String(error) };
  }
});

// Handle speak request (legacy API - proxies to Chatterbox)
ipcMain.handle('orpheus:speak', async (_event, text: string, voice: string) => {
  console.log(`[IPC] orpheus:speak called - voice: ${voice}, text length: ${text?.length || 0} chars`);
  console.log(`[IPC] Text preview: "${text?.substring(0, 100)}..."`);
  
  if (!text || text.length === 0) {
    console.error('[IPC] Empty text received!');
    return { success: false, error: 'Empty text' };
  }
  
  // Warn if text is suspiciously long
  if (text.length > 500) {
    console.warn(`[IPC] ⚠️ Long text received: ${text.length} chars - this may be slow!`);
  }
  
  try {
    // Use unified status check that detects external servers
    const url = await getCurrentBaseUrl();
    if (!url) {
      console.error('[IPC] No TTS server available');
      return { success: false, error: 'No TTS server available' };
    }
    
    console.log(`[IPC] Sending to ${url}/v1/audio/speech (Chatterbox)...`);
    
    // Build request - Chatterbox uses minimal request body
    const body: Record<string, string> = {
      input: text,
      response_format: 'wav',
    };
    
    // Add voice if it's a custom named voice (not 'default' or empty)
    if (voice && voice !== 'default') {
      body.voice = voice;
    }
    
    const response = await fetch(`${url}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      console.error(`[IPC] TTS request failed: HTTP ${response.status}`);
      return { success: false, error: `HTTP ${response.status}` };
    }
    
    // Save audio to temp file and return URL for custom protocol
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    console.log(`[IPC] ✓ Received ${uint8Array.length} bytes of audio`);
    
    // Write to temp file
    const tempDir = app.getPath('temp');
    const fileName = `orpheus-tts-${Date.now()}.wav`;
    const tempFile = path.join(tempDir, fileName);
    fs.writeFileSync(tempFile, Buffer.from(uint8Array));
    console.log(`[IPC] Saved audio to: ${tempFile}`);
    
    // Return custom protocol URL that renderer can fetch
    return { success: true, audioUrl: `orpheus-audio://${fileName}` };
  } catch (error) {
    console.error('[IPC] Failed to generate speech:', error);
    return { success: false, error: String(error) };
  }
});

// Legacy handlers for backwards compatibility
ipcMain.handle('orpheus-status', async () => {
  return getOrpheusStatus();
});

ipcMain.handle('orpheus-url', () => {
  return getOrpheusUrl();
});

// =============================================================================
// New Unified TTS API - supports multiple engines (Orpheus, Chatterbox)
// =============================================================================

// Get list of installed TTS engines
ipcMain.handle('tts:getEngines', () => {
  console.log('[IPC] tts:getEngines called');
  return getInstalledEngines();
});

// Start a specific TTS engine (stops any currently running engine first)
ipcMain.handle('tts:start', async (_event, engineId: TTSEngine) => {
  console.log(`[IPC] tts:start called with engine: ${engineId}`);
  try {
    const config = await startEngine(engineId);
    console.log(`[IPC] ✓ ${engineId} started successfully`);
    
    // Notify renderer that TTS is ready
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tts:ready', config);
    }
    
    return config;
  } catch (error) {
    console.error(`[IPC] Failed to start ${engineId}:`, error);
    throw error;
  }
});

// Stop the currently running TTS engine
ipcMain.handle('tts:stop', () => {
  console.log('[IPC] tts:stop called');
  stopCurrentEngine();
  return { success: true };
});

// Get current TTS engine config (if running)
ipcMain.handle('tts:getConfig', async () => {
  return getCurrentConfig();
});

// Get current TTS engine status
ipcMain.handle('tts:getStatus', async () => {
  return getCurrentStatus();
});

// Generate speech using the current TTS engine
ipcMain.handle('tts:speak', async (_event, text: string, voice: string) => {
  console.log(`[IPC] tts:speak called - voice: ${voice}, text length: ${text?.length || 0}`);
  
  const baseUrl = await getCurrentBaseUrl();
  if (!baseUrl) {
    console.error('[IPC] No TTS engine running');
    return { success: false, error: 'No TTS engine running' };
  }
  
  if (!text || text.length === 0) {
    console.error('[IPC] Empty text received');
    return { success: false, error: 'Empty text' };
  }
  
  if (text.length > 500) {
    console.warn(`[IPC] ⚠️ Long text: ${text.length} chars - may be slow`);
  }
  
  try {
    // Build request body - Chatterbox uses minimal request
    const body: Record<string, string> = {
      input: text,
      response_format: 'wav',
    };
    
    // Only add voice if it's a custom named voice (not 'default' or empty)
    if (voice && voice !== 'default') {
      body.voice = voice;
    }
    
    console.log(`[IPC] Sending to ${baseUrl}/v1/audio/speech (Chatterbox)...`);
    
    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      console.error(`[IPC] TTS request failed: HTTP ${response.status}`);
      return { success: false, error: `HTTP ${response.status}` };
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    console.log(`[IPC] ✓ Received ${uint8Array.length} bytes of audio`);
    
    // Write to temp file
    const tempDir = app.getPath('temp');
    const fileName = `tts-audio-${Date.now()}.wav`;
    const tempFile = path.join(tempDir, fileName);
    fs.writeFileSync(tempFile, Buffer.from(uint8Array));
    console.log(`[IPC] Saved audio to: ${tempFile}`);
    
    // Return custom protocol URL
    return { success: true, audioUrl: `orpheus-audio://${fileName}` };
  } catch (error) {
    console.error('[IPC] Failed to generate speech:', error);
    return { success: false, error: String(error) };
  }
});

// Get available voices for the current TTS engine
ipcMain.handle('tts:getVoices', async () => {
  const status = await getCurrentStatus();
  if (!status.engine || !status.ready) {
    return { voices: [], error: 'No TTS engine running' };
  }
  
  try {
    const voices = await fetchVoices(status.engine);
    return { voices };
  } catch (error) {
    console.error('[IPC] Failed to get voices:', error);
    return { voices: [], error: String(error) };
  }
});

// Register custom protocol for serving audio files
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'orpheus-audio',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    }
  }
]);

// App lifecycle events

app.whenReady().then(async () => {
  // Register protocol handler for audio files
  protocol.handle('orpheus-audio', (request) => {
    const fileName = request.url.replace('orpheus-audio://', '');
    const tempDir = app.getPath('temp');
    const filePath = path.join(tempDir, fileName);
    console.log(`[Protocol] Serving audio file: ${filePath}`);
    return net.fetch(`file://${filePath}`);
  });
  
  // Remove default application menu
  Menu.setApplicationMenu(null);
  
  setupDeepLinking();
  
  const useTTSTest = process.env.TTS_TEST === 'true';
  
  // POC Mode: Don't auto-start any TTS engine
  // Let the user choose which engine to use via the UI
  // The renderer can call window.localTTS.start('orpheus') or window.localTTS.start('chatterbox')
  console.log('=== TTS ENGINES AVAILABLE (POC Mode) ===');
  const installedEngines = getInstalledEngines();
  for (const engine of installedEngines) {
    console.log(`  - ${engine.name}: ${engine.installed ? '✓ ready' : '✗ not installed'}`);
  }
  console.log('=== User must select TTS engine via UI ===');
  
  // Create main window first (hidden) - waits for server if in dev mode
  await createWindow();
  
  // Show splash screen (but not for TTS test)
  if (!useTTSTest) {
    createSplashWindow();
  }
  
  // Enable auto-updater in production
  if (app.isPackaged) {
    console.log('Starting auto-updater...');
    setupAutoUpdater();
  } else {
    console.log('Auto-updater disabled in development mode');
  }
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  // Clean up auto-updater
  cleanupAutoUpdater();
  
  // Stop any running TTS engine
  stopCurrentEngine();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// On macOS, re-create window when dock icon is clicked
app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

// Handle deep link URLs (for OAuth callbacks)
app.on('open-url', (event, url) => {
  event.preventDefault();
  
  console.log('Deep link received:', url);
  
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
    
    // For OAuth callbacks, convert the protocol URL to the proper web URL
    // tirona://oauth-callback?... => https://tironabattlemap.vercel.app/...
    if (url.startsWith('tirona://')) {
      const config = loadConfig();
      const baseUrl = app.isPackaged 
        ? config.production.url 
        : config.development.url;
      
      // Extract the path and query params from the deep link
      const urlObj = new URL(url);
      const callbackPath = urlObj.pathname + urlObj.search;
      
      // Navigate to the proper callback URL on your domain
      const callbackUrl = `${baseUrl}${callbackPath}`;
      console.log('Navigating to:', callbackUrl);
      
      mainWindow.webContents.executeJavaScript(`
        window.location.href = '${callbackUrl}';
      `);
    } else {
      // For other deep links, load directly
      mainWindow.loadURL(url);
    }
  }
});

// Cleanup on app quit
app.on('will-quit', () => {
  console.log('Application shutting down...');
  stopCurrentEngine();
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

