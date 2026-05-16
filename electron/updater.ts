import { dialog, ipcMain } from 'electron';
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
  autoUpdater.once('update-not-available', () => {
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'No Updates',
        message: 'You are running the latest version.',
      });
    }
  });
  autoUpdater.once('error', (err) => {
    log.error('Manual update check failed.', err);
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Check Failed',
        message: 'Could not check for updates. Please try again later.',
        detail: err.message,
      });
    }
  });
  void autoUpdater.checkForUpdatesAndNotify();
}

// IPC handler for manual update check
export function registerUpdateIPC() {
  ipcMain.handle('updater:check', () => {
    checkForUpdatesManually(null);
    return true;
  });
}
