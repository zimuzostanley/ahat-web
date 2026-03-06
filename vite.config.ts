import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [viteSingleFile()],
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'm',
    jsxFragment: 'Fragment',
  },
  worker: {
    format: 'es',
  },
  test: {
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 60_000,
    hookTimeout: 600_000,
  },
})
