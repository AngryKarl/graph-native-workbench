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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@xyflow')) return 'graph-editor';
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('unified')) return 'markdown';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react-vendor';
          if (id.includes('lucide-react')) return 'icons';
          return undefined;
        },
      },
    },
  },
});
