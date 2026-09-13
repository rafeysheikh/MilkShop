/**
 * preload.cjs — Secure bridge between Electron main process and React renderer
 * 
 * Only the APIs explicitly listed here are accessible from React via window.electronAPI.
 * Node.js / Electron internals are NOT directly accessible from the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── License ──────────────────────────────────────────────────────────────
  getMachineId:       ()        => ipcRenderer.invoke('license:getMachineId'),
  validateLicense:    (key)     => ipcRenderer.invoke('license:validate', key),
  saveLicense:        (key)     => ipcRenderer.invoke('license:save', key),
  checkSavedLicense:  ()        => ipcRenderer.invoke('license:checkSaved'),

  // ── Storage ───────────────────────────────────────────────────────────────
  storageGet:    (key)        => ipcRenderer.invoke('storage:get', key),
  storageSet:    (key, value) => ipcRenderer.invoke('storage:set', key, value),
  storageRemove: (key)        => ipcRenderer.invoke('storage:remove', key),

  // ── Utilities ─────────────────────────────────────────────────────────────
  getDataPath:        ()  => ipcRenderer.invoke('app:getDataPath'),
  openDataFolder:     ()  => ipcRenderer.invoke('app:openDataFolder'),
  openBackupFolder:   ()  => ipcRenderer.invoke('app:openBackupFolder'),
  checkBackupImport:  ()  => ipcRenderer.invoke('app:checkBackupImport'),
});
