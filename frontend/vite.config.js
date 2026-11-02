import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Mobile performance audit (2026-11-02): third-party libraries change
        // far less often than app code. Keeping them in their own chunk means
        // their content hash survives most deploys, so returning visitors
        // (and phones on slow connections) only re-download app code.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-data': ['@supabase/supabase-js', '@tanstack/react-query', 'zustand'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    globals: true,
  },
})
