import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // 'server-only' guards Next.js client bundles; it is meaningless (and
      // throws) under vitest's node environment.
      'server-only': path.resolve(__dirname, 'tests/mocks/server-only.ts'),
    },
  },
  test: {
    // Adversarial/eval suites hit the real database and models; their
    // describes are gated by RUN_ADVERSARIAL / RUN_HELDOUT and show as
    // skipped in a plain `pnpm test`. Run them via `pnpm eval:*`.
    include: [
      'tests/unit/**/*.test.ts',
      'tests/adversarial/**/*.test.ts',
      'tests/eval/**/*.test.ts',
      'src/**/*.test.ts',
    ],
    environment: 'node',
  },
});
