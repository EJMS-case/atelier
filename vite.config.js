import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Build identity, injected into ai_errors payloads (see lib/ai/logError.js).
// Vercel exposes the commit SHA in env; local builds fall back to git, then "dev".
const sha = process.env.VERCEL_GIT_COMMIT_SHA
  || (() => { try { return execSync('git rev-parse HEAD').toString().trim() } catch { return '' } })()
const BUILD_ID = (sha || 'dev').slice(0, 7)

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
})
