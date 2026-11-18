import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5174, strictPort: true },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'e2e/**/*.test.ts', 'checks/**/*.spec.tsx'],
    environment: 'node',
  },
});
