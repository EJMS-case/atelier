#!/bin/bash
# SessionStart hook: install dependencies so tests and builds work immediately.
# Runs only in remote sessions (Claude Code on the web / Cowork); local checkouts
# manage their own node_modules.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm install (not ci) so the cached container image can reuse an existing tree.
npm install --no-audit --no-fund
