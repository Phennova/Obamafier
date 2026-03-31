import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { registerIpcHandlers } from './ipc-handlers.js';
import { IPC_CHANNELS } from '../common/constants.js';

let mainWindow: BrowserWindow | null = null;

function getTargetImagePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'obama.jpg');
  }
  return path.join(app.getAppPath(), 'assets', 'obama.jpg');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 750,
    minWidth: 700,
    minHeight: 600,
    title: 'Obamafier',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Auto-Updater ─────────────────────────────────────────────

function setupAutoUpdater() {
  // Only run in packaged builds
  if (!app.isPackaged) return;

  // Dynamic import so dev builds don't fail if electron-updater isn't installed
  import('electron-updater').then(({ autoUpdater }) => {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info: any) => {
      console.log('[updater] Update available:', info.version);
      mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_AVAILABLE, info.version);
    });

    autoUpdater.on('download-progress', (progress: any) => {
      mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, Math.round(progress.percent));
    });

    autoUpdater.on('update-downloaded', (info: any) => {
      console.log('[updater] Update downloaded:', info.version);
      mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_DOWNLOADED, info.version);
    });

    autoUpdater.on('error', (err: Error) => {
      console.error('[updater] Error:', err.message);
    });

    // Listen for install request from renderer
    ipcMain.on(IPC_CHANNELS.UPDATE_INSTALL, () => {
      autoUpdater.quitAndInstall(false, true);
    });

    // Check for updates after a short delay
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err: Error) => {
        console.error('[updater] Check failed:', err.message);
      });
    }, 3000);
  }).catch((err) => {
    console.log('[updater] electron-updater not available:', err.message);
  });
}

// ─── App Lifecycle ────────────────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers(getTargetImagePath);
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
