import { app, BrowserWindow, shell, ipcMain, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

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
 */
const createWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
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

  // Remove default menu from main window
  mainWindow.setMenu(null);

  // Load the appropriate URL based on environment
  const config = loadConfig();
  // Use production URL if packaged OR if ELECTRON_PROD env var is set
  const isProduction = app.isPackaged || process.env.ELECTRON_PROD === 'true';
  const startUrl = isProduction
    ? config.production.url 
    : config.development.url;

  console.log(`Loading application from: ${startUrl}`);
  console.log(`Mode: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  
  // In development, wait for server to be ready before loading
  if (!isProduction) {
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
    if (errorCode === -3 || errorCode === -6) { // ERR_ABORTED or ERR_CONNECTION_REFUSED
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

  mainWindow.loadURL(startUrl);

  // Don't auto-show - will be shown after splash finishes
  mainWindow.once('ready-to-show', () => {
    // Window is ready but don't show yet if splash is active
    if (!splashWindow) {
      mainWindow?.show();
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

// App lifecycle events

app.whenReady().then(async () => {
  // Remove default application menu
  Menu.setApplicationMenu(null);
  
  setupDeepLinking();
  
  // Create main window first (hidden) - waits for server if in dev mode
  await createWindow();
  
  // Show splash screen
  createSplashWindow();
  
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

