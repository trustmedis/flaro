import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/',
  build: { outDir: 'dist', assetsDir: 'admin/assets' },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // Admin API + realtime endpoints live on the worker (pnpm dev at repo root, :8787).
  server: {
    proxy: {
      '/admin': 'http://127.0.0.1:8787',
      '/app': { target: 'http://127.0.0.1:8787', ws: true },
      '/v1': { target: 'http://127.0.0.1:8787', ws: true },
    },
  },
});
