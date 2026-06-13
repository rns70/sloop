import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // src/eval depends on the removed CascadeEngine/architect; excluded until reworked
    // onto the ADR runner (see docs/superpowers/specs/2026-06-13-executable-adrs-design.md).
    exclude: ['node_modules/**', 'src/eval/**'],
  },
});
