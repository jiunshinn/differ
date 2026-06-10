import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src'),
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@uiw/codemirror-extensions-langs')) return 'codemirror-langs';
          if (id.includes('@uiw/react-codemirror')) return 'codemirror-react';
          if (id.includes('@uiw/codemirror-theme-github')) return 'codemirror-theme';
          if (id.includes('@codemirror/lang-') || id.includes('@codemirror/legacy-modes')) return 'codemirror-langpacks';
          if (id.includes('@codemirror/state')) return 'codemirror-state';
          if (id.includes('@codemirror/view') || id.includes('style-mod') || id.includes('w3c-keyname') || id.includes('crelt')) {
            return 'codemirror-view';
          }
          if (id.includes('@codemirror/language')) return 'codemirror-language';
          if (
            id.includes('@codemirror/autocomplete') ||
            id.includes('@codemirror/commands') ||
            id.includes('@codemirror/search') ||
            id.includes('@codemirror/lint')
          ) {
            return 'codemirror-addons';
          }
          if (id.includes('@lezer')) return 'codemirror-lezer';
          if (id.includes('@tanstack')) return 'tanstack';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('@radix-ui') || id.includes('@floating-ui')) return 'radix';
          if (id.includes('zustand')) return 'zustand';
          return undefined;
        },
      },
    },
  },
});
