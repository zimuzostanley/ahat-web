import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
