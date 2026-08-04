import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4311,
    proxy: {
      '/api': 'http://127.0.0.1:4310',
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/client'),
    emptyOutDir: true,
  },
});
