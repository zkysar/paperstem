/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  // Pages serves the site under /paperstem/. Override locally with `--base=/` if needed.
  base: '/paperstem/',
  plugins: [react()],
  server: {
    port: 8765,
  },
  test: {
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
  },
});
