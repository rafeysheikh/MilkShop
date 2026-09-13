import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',        // Required for Electron — loads assets with relative paths
  server: {
    port: 3000,
    open: false,
    watch: {
      // Exclude build output folders so Vite doesn't lock files during electron-builder packaging
      ignored: ['**/release/**', '**/electron/**', '**/tools/**'],
    },
  },
});
