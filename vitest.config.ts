import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.types.ts'],
    },
  },
  resolve: {
    alias: {
      '@modules': path.resolve(__dirname, 'src/modules'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
