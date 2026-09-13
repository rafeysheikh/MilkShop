/**
 * storagePolyfill.js
 *
 * When running inside the Electron desktop app, all data is saved to a real
 * JSON file on disk: Documents\MilkShop\data.json (via Electron IPC).
 *
 * When running in a browser (dev mode / localhost), data is saved to
 * localStorage as a fallback so development still works normally.
 */
if (typeof window !== "undefined" && !window.storage) {
  if (window.electronAPI) {
    // ── Electron: file-based storage via IPC ────────────────────────────────
    window.storage = {
      get: async (key) => {
        try {
          const value = await window.electronAPI.storageGet(key);
          return value !== null ? { value } : null;
        } catch (err) {
          console.error("Storage get error (Electron):", err);
          return null;
        }
      },
      set: async (key, value) => {
        try {
          await window.electronAPI.storageSet(key, value);
        } catch (err) {
          console.error("Storage set error (Electron):", err);
        }
      },
    };
  } else {
    // ── Browser / Dev mode: localStorage fallback ────────────────────────────
    window.storage = {
      get: async (key) => {
        try {
          const value = window.localStorage.getItem(key);
          return value !== null ? { value } : null;
        } catch (err) {
          console.error("Storage get error (localStorage):", err);
          return null;
        }
      },
      set: async (key, value) => {
        try {
          window.localStorage.setItem(key, value);
        } catch (err) {
          console.error("Storage set error (localStorage):", err);
        }
      },
    };
  }
}
