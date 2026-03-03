import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
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
