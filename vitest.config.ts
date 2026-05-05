import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: false,
        plugins: [react()],
        test: {
          name: 'client',
          root: 'src/client',
          environment: 'happy-dom',
          setupFiles: ['./test-setup.ts'],
          include: ['**/*.test.{ts,tsx}'],
        },
      },
      {
        extends: false,
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/server/**/*.test.ts'],
        },
      },
    ],
  },
});
