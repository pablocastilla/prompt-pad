import { BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

let updateCheckInterval: ReturnType<typeof setInterval> | null = null;

export function setupAutoUpdater(mainWindow: Electron.BrowserWindow | null) {
  log.transports.file.level = 'info';
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
  });
  autoUpdater.on('update-available', (info) => {
    log.info('Update available.', info.version);
  });
  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available.', info.version);
  });
  autoUpdater.on('error', (err) => {
    log.error('Error in auto-updater.', err);
    // Show user-friendly error for common issues
    let detail = 'Please try again later.';
    const msg = err?.message?.toLowerCase() ?? '';
    if (msg.includes('404') || msg.includes('not found')) {
      detail = 'This version has not been released yet. You are running the latest available version.';
    } else if (msg.includes('net::') || msg.includes('network') || msg.includes('fetch')) {
      detail = 'A network error occurred. Check your internet connection and try again.';
    } else if (msg.includes('permission') || msg.includes('access')) {
      detail = 'Permission denied. Try running the app as administrator.';
    } else if (msg.includes('certificate') || msg.includes('ssl') || msg.includes('tls')) {
      detail = 'A security certificate error occurred. Check your network configuration.';
    }
    if (mainWindow) {
      mainWindow.webContents.send('update:error', { message: err.message, detail });
    }
  });
  autoUpdater.on('download-progress', (progressObj) => {
    log.info('Download progress...', progressObj.percent.toFixed(1) + '%');
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded.', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update:available', {
        version: info.version,
        releaseNotes: info.releaseNotes,
      });
    }
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `A new version (${info.version}) has been downloaded. Restart to apply?`,
      buttons: ['Restart', 'Later']
    }).then(result => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  void autoUpdater.checkForUpdatesAndNotify();

  // Periodic check every 4 hours
  if (updateCheckInterval) clearInterval(updateCheckInterval);
  updateCheckInterval = setInterval(() => {
    void autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000);
}

export function checkForUpdatesManually(mainWindow: Electron.BrowserWindow | null) {
  log.info('Manual update check requested.');
  autoUpdater.once('update-available', (info) => {
    log.info('Update available (manual check).', info.version);
    dialog.showMessageBox(mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined as any, {
      type: 'info',
      title: 'Update Available',
      message: `A new version (${info.version}) is available. It will be downloaded in the background.`,
    });
  });
  autoUpdater.once('update-not-available', () => {
    log.info('No updates found.');
    dialog.showMessageBox(mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined as any, {
      type: 'info',
      title: 'No Updates',
      message: 'You are running the latest version.',
    });
  });
  autoUpdater.once('error', (err) => {
    log.error('Manual update check failed.', err);
    let detail = 'Please try again later.';
    const msg = err?.message?.toLowerCase() ?? '';
    if (msg.includes('404') || msg.includes('not found')) {
      detail = 'This version has not been released yet. You are running the latest available version.';
    } else if (msg.includes('net::') || msg.includes('network') || msg.includes('fetch')) {
      detail = 'A network error occurred. Check your internet connection.';
    } else if (msg.includes('permission') || msg.includes('access')) {
      detail = 'Permission denied. Try running as administrator.';
    } else if (msg.includes('certificate') || msg.includes('ssl')) {
      detail = 'Certificate error. Check your network configuration.';
    }
    dialog.showMessageBox(mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined as any, {
      type: 'error',
      title: 'Update Check Failed',
      message: 'Could not check for updates.',
      detail: `${err.message}\n\n${detail}`,
    });
  });
  void autoUpdater.checkForUpdatesAndNotify();
}

// IPC handler for manual update check
export function registerUpdateIPC() {
  ipcMain.handle('updater:check', () => {
    checkForUpdatesManually(BrowserWindow.getFocusedWindow());
    return true;
  });
}
