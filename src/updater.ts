import { autoUpdater } from 'electron-updater';
import { dialog, BrowserWindow } from 'electron';

/**
 * Configure and manage application auto-updates
 * Checks GitHub Releases for new versions
 */

let updateCheckInterval: NodeJS.Timeout | null = null;

/**
 * Configure auto-updater settings
 */
export const setupAutoUpdater = (): void => {
  // Configure logging
  autoUpdater.logger = console;
  
  // Don't automatically download updates
  autoUpdater.autoDownload = false;
  
  // Check for updates immediately on startup
  console.log('Checking for updates...');
  autoUpdater.checkForUpdates();
  
  // Check for updates every 4 hours
  updateCheckInterval = setInterval(() => {
    console.log('Periodic update check...');
    autoUpdater.checkForUpdates();
  }, 4 * 60 * 60 * 1000); // 4 hours
};

/**
 * Clean up update checker on app quit
 */
export const cleanupAutoUpdater = (): void => {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
};

/**
 * Show update available notification
 */
const showUpdateAvailable = (info: { version: string }): void => {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  
  if (!mainWindow) return;
  
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Available',
    message: `A new version (${info.version}) is available!`,
    detail: 'Would you like to download it now? The update will be installed ' +
            'the next time you restart the app.',
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
  }).then((result) => {
    if (result.response === 0) {
      // User clicked "Download"
      autoUpdater.downloadUpdate();
      
      // Show downloading notification
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Downloading Update',
        message: 'Update is downloading in the background.',
        detail: 'You will be notified when it\'s ready to install.',
        buttons: ['OK'],
      });
    }
  });
};

/**
 * Show update downloaded notification
 */
const showUpdateDownloaded = (): void => {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  
  if (!mainWindow) return;
  
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Ready',
    message: 'Update has been downloaded!',
    detail: 'The update will be installed when you restart the app. ' +
            'Would you like to restart now?',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  }).then((result) => {
    if (result.response === 0) {
      // User clicked "Restart Now"
      autoUpdater.quitAndInstall(false, true);
    }
  });
};

/**
 * Handle update errors
 */
const handleUpdateError = (error: Error): void => {
  console.error('Update error:', error);
  
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) return;
  
  // Only show error dialog if it's not a network error
  if (!error.message.includes('net::')) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Update Error',
      message: 'Failed to check for updates',
      detail: 'Please check your internet connection and try again later.',
      buttons: ['OK'],
    });
  }
};

// Event handlers
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  showUpdateAvailable(info);
});

autoUpdater.on('update-not-available', () => {
  console.log('Update not available - you have the latest version');
});

autoUpdater.on('download-progress', (progressObj) => {
  const logMessage = `Download speed: ${progressObj.bytesPerSecond} - ` +
                     `Downloaded ${progressObj.percent}% ` +
                     `(${progressObj.transferred}/${progressObj.total})`;
  console.log(logMessage);
});

autoUpdater.on('update-downloaded', () => {
  console.log('Update downloaded');
  showUpdateDownloaded();
});

autoUpdater.on('error', (error) => {
  handleUpdateError(error);
});

