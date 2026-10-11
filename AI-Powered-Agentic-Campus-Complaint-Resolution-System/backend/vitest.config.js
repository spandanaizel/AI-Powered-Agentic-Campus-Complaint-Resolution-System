import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setupEnv.js'],
    // Integration files share one database server; run files one at a time for isolation.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
