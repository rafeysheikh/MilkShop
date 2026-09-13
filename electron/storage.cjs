/**
 * storage.cjs — File-based persistent storage for MilkShop
 * 
 * Active database is saved to: Documents\MilkShop\data.json
 * Backup is kept at: Documents\MilkShop\data_backup.json
 * 
 * In addition, there is a dedicated 'backup' folder in the installed directory
 * of the application. Users can paste a backup .json file there at any time,
 * and the application will automatically detect and load it.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

// ─── Paths ────────────────────────────────────────────────────────────────────

function getDataDir() {
  const dir = path.join(os.homedir(), 'Documents', 'MilkShop');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getDataFilePath() {
  return path.join(getDataDir(), 'data.json');
}

function getBackupFilePath() {
  return path.join(getDataDir(), 'data_backup.json');
}

/**
 * Returns the installation directory of the application
 */
function getInstallDir() {
  if (app && app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  return path.resolve(__dirname, '..');
}

/**
 * Returns the 'backup' folder located in the installed directory of the application.
 * Creates it automatically if it does not already exist.
 */
function getAppBackupFolder() {
  const backupDir = path.join(getInstallDir(), 'backup');
  if (!fs.existsSync(backupDir)) {
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      const readmePath = path.join(backupDir, 'README.txt');
      if (!fs.existsSync(readmePath)) {
        fs.writeFileSync(
          readmePath,
          '=== DOODH KHATA BACKUP RESTORE FOLDER ===\r\n\r\n' +
          'Paste your previous backup file (.json) into this folder.\r\n' +
          'When Doodh Khata starts (or via Settings > Load from Backup Folder),\r\n' +
          'it will automatically load your previous data.\r\n',
          'utf8'
        );
      }
    } catch (err) {
      console.warn('[Storage] Could not create backup folder:', err.message);
    }
  }
  return backupDir;
}

// ─── Read / Write ─────────────────────────────────────────────────────────────

function readAllDataDirect() {
  try {
    const filePath = getDataFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('[Storage] Error reading data file:', err.message);
    // Try backup
    try {
      const backupPath = getBackupFilePath();
      if (fs.existsSync(backupPath)) {
        const raw = fs.readFileSync(backupPath, 'utf8');
        console.warn('[Storage] Restored from backup file.');
        return JSON.parse(raw);
      }
    } catch {
      // ignore
    }
  }
  return {};
}

/**
 * Checks the installed application's 'backup' folder for any newly pasted .json backup files.
 * If found, loads the data into the active database and marks the file as .imported.
 */
function checkForPendingBackupImport() {
  try {
    const backupDir = getAppBackupFolder();
    if (!fs.existsSync(backupDir)) return null;

    const files = fs.readdirSync(backupDir);
    // Look for .json files (exclude already imported .imported or other extensions)
    const jsonFiles = files.filter((f) => f.toLowerCase().endsWith('.json') && !f.toLowerCase().includes('.imported'));
    if (jsonFiles.length === 0) return null;

    // Pick newest file
    const sorted = jsonFiles.map((f) => {
      const fullPath = path.join(backupDir, f);
      const stat = fs.statSync(fullPath);
      return { file: f, path: fullPath, mtime: stat.mtime };
    }).sort((a, b) => b.mtime - a.mtime);

    const target = sorted[0];
    console.log('[Storage] Found backup file to import:', target.path);
    const raw = fs.readFileSync(target.path, 'utf8');
    const parsed = JSON.parse(raw);

    let stateString = null;
    let stateObj = null;

    if (parsed.dairy_ledger_state_v1) {
      stateString = typeof parsed.dairy_ledger_state_v1 === 'string'
        ? parsed.dairy_ledger_state_v1
        : JSON.stringify(parsed.dairy_ledger_state_v1);
      stateObj = JSON.parse(stateString);
    } else if (parsed.customers || parsed.suppliers) {
      stateObj = parsed;
      stateString = JSON.stringify(parsed);
    }

    if (stateString && stateObj) {
      const activeData = readAllDataDirect();
      activeData['dairy_ledger_state_v1'] = stateString;
      writeAllData(activeData);

      // Rename target file to .imported so we don't repeatedly overwrite on every subsequent launch
      const importedPath = path.join(backupDir, `${target.file}.imported`);
      try {
        if (fs.existsSync(importedPath)) fs.unlinkSync(importedPath);
        fs.renameSync(target.path, importedPath);
      } catch (renameErr) {
        console.warn('[Storage] Could not rename backup file:', renameErr.message);
      }

      console.log(`[Storage] Successfully restored data from backup folder: ${target.file}`);
      return { success: true, file: target.file, state: stateObj };
    }
  } catch (err) {
    console.error('[Storage] Error importing from backup folder:', err.message);
    return { success: false, error: err.message };
  }
  return null;
}

function readAllData() {
  // Check for any backup file placed in the application's install backup folder
  checkForPendingBackupImport();
  return readAllDataDirect();
}

function writeAllData(data) {
  try {
    const filePath = getDataFilePath();
    const backupPath = getBackupFilePath();

    // Rotate backup before writing new data
    if (fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, backupPath);
      } catch {
        // ignore backup failure, still write main file
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Storage] Error writing data file:', err.message);
    return false;
  }
}

// ─── Item-level API (mirrors window.storage polyfill) ────────────────────────

/**
 * Get a value by key. Returns the value (string) or null.
 */
function getItem(key) {
  const data = readAllData();
  const val = data[key];
  return val !== undefined ? val : null;
}

/**
 * Set a value by key. Value should be a string (JSON-encoded).
 */
function setItem(key, value) {
  const data = readAllDataDirect();
  data[key] = value;
  return writeAllData(data);
}

/**
 * Remove a key from storage.
 */
function removeItem(key) {
  const data = readAllDataDirect();
  delete data[key];
  return writeAllData(data);
}

module.exports = {
  getItem,
  setItem,
  removeItem,
  getDataDir,
  getDataFilePath,
  getAppBackupFolder,
  checkForPendingBackupImport,
};
