/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// No secrets are injected into the bundle: all LLM calls go through the backend.
// Only variables prefixed VITE_API_ are ever exposed to client code, so a stray
// VITE_*_KEY left in a .env file cannot leak into the build.
// In dev, /api is proxied to the FastAPI server so the refresh cookie stays same-origin.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
  envPrefix: 'VITE_API_',
  server: {
    proxy: { '/api': { target: process.env.VITE_DEV_API || 'http://localhost:8000' } },
  },
})
