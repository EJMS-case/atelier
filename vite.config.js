import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Rewrites dist/sw.js after build so the service-worker cache name is unique
// per deploy — the sw's activate handler then prunes the previous deploy's
// cache instead of letting old hashed assets pile up forever.
function stampServiceWorker() {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    closeBundle() {
      const swPath = resolve(__dirname, 'dist/sw.js')
      const stamp = Date.now().toString(36)
      writeFileSync(swPath, readFileSync(swPath, 'utf8').replace('__BUILD_ID__', stamp))
    },
  }
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
})
