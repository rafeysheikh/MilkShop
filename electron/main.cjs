/**
 * main.cjs — Electron main process for MilkShop (Doodh Khata)
 * 
 * Responsibilities:
 *  - Creates the BrowserWindow
 *  - Registers IPC handlers for license + storage operations
 *  - In development: loads http://localhost:3000 (Vite dev server)
 *  - In production: loads the built dist/index.html
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const license = require('./license.cjs');
const storage = require('./storage.cjs');

// app.isPackaged = false when running via `electron .` in dev, true when installed
const isDev = !app.isPackaged;

let mainWindow;

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Doodh Khata — Milk Supply Ledger',
    backgroundColor: '#0F1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,       // Security: no Node in renderer
      contextIsolation: true,       // Security: isolate contexts
      devTools: isDev,              // Disable DevTools in production
    },
    // Use icon if available
    ...(process.platform === 'win32' && {
      icon: path.join(__dirname, '../build/icon.ico'),
    }),
  });

  // Remove the menu bar (no File/Edit/View menus shown)
  mainWindow.setMenuBarVisibility(false);

  // Prevent new windows from opening (security)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  // ── License handlers ──────────────────────────────────────────────────────

  ipcMain.handle('license:getMachineId', () => {
    return license.getMachineFingerprint();
  });

  ipcMain.handle('license:validate', (_, licenseKey) => {
    const machineId = license.getMachineFingerprint();
    return license.validateLicenseKey(licenseKey, machineId);
  });

  ipcMain.handle('license:save', (_, licenseKey) => {
    license.saveLicense(licenseKey);
    return true;
  });

  ipcMain.handle('license:checkSaved', () => {
    const machineId = license.getMachineFingerprint();
    const savedKey = license.loadSavedLicense();

    if (savedKey) {
      const result = license.validateLicenseKey(savedKey, machineId);
      if (result.valid) {
        return { ...result, isTrial: false };
      }
      if (result.expired) {
        return { ...result, isTrial: false, expired: true };
      }
    }

    // No valid saved license -> check 7-day trial status
    const trial = license.checkTrialStatus(machineId);
    if (!trial.trialExpired) {
      return {
        valid: true,
        isTrial: true,
        trialDaysLeft: trial.daysLeft,
        machineId,
      };
    }

    return {
      valid: false,
      isTrial: true,
      trialExpired: true,
      reason: trial.reason || 'Your 7-day trial period has ended. Please enter your activation code.',
      machineId,
    };
  });

  // ── Storage handlers ──────────────────────────────────────────────────────

  ipcMain.handle('storage:get', (_, key) => {
    return storage.getItem(key);
  });

  ipcMain.handle('storage:set', (_, key, value) => {
    return storage.setItem(key, value);
  });

  ipcMain.handle('storage:remove', (_, key) => {
    return storage.removeItem(key);
  });

  // ── App utilities ─────────────────────────────────────────────────────────

  ipcMain.handle('app:getDataPath', () => {
    return storage.getDataFilePath();
  });

  ipcMain.handle('app:openDataFolder', () => {
    shell.openPath(storage.getDataDir());
    return true;
  });

  ipcMain.handle('app:openBackupFolder', () => {
    const backupDir = storage.getAppBackupFolder();
    shell.openPath(backupDir);
    return backupDir;
  });

  ipcMain.handle('app:checkBackupImport', () => {
    return storage.checkForPendingBackupImport();
  });
}
