import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

import { pdfJsAssetsPlugin } from './vite/pdfJsAssetsPlugin';

export default defineConfig({
  test: {
    // Packaging uses Node's test runner, not Vitest.
    exclude: [...configDefaults.exclude, '**/scripts/onboarding-resources.test.cjs']
  },
  plugins: [react(), tailwindcss(), pdfJsAssetsPlugin()],
  clearScreen: false,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  }
});
