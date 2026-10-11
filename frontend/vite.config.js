import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API is proxied so the session cookie is same-origin.
// In production serve the built app and the API from the same site (see EXECUTION_GUIDE.md).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_DEV_API_TARGET || 'http://localhost:5000', changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: process.env.VITE_DEV_API_TARGET || 'http://localhost:5000', changeOrigin: false } },
  },
  build: {
    rollupOptions: {
      output: {
        // Charts are only needed on admin pages; keep them out of the main bundle.
        manualChunks: { charts: ['recharts'], react: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
