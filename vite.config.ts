import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    // dev: same-origin signaling (deploy/peer-server.mjs) so online host/join
    // works in the dev server exactly like the deployed site
    proxy: { '/peerjs': { target: 'http://127.0.0.1:9100', ws: true } },
  },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
})
