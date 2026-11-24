import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    // dev: same-origin signaling (deploy/signal-server.mjs) so online host/join
    // works in the dev server exactly like the deployed site
    proxy: { '/signal': { target: 'http://127.0.0.1:9100' } },
  },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
})
