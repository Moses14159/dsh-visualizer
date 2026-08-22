/**
 * Vitest config for dsh-visualizer. The pure-logic suites (chartspec,
 * to-echarts) need no DSH packages, no DOM, and no module mocks — they run
 * in the default node environment.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
