import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['{lib,components,app,scripts}/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['legacy/**', 'node_modules/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      // The metric derivations are the part of this codebase where a silent
      // error is most expensive — a wrong APR looks entirely plausible.
      thresholds: { 'lib/metrics/**': { statements: 90, branches: 85, functions: 90, lines: 90 } },
    },
  },
});
