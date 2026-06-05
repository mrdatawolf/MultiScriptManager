#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PASS=0
FAIL=0
WARN=0

ok()   { echo "  [OK]   $*"; PASS=$((PASS+1)); }
fail() { echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }
warn() { echo "  [WARN] $*"; WARN=$((WARN+1)); }

echo ""
echo "Multi Script Manager — pre-flight checks"
echo "========================================="

# ── Node.js ──────────────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node --version 2>/dev/null | sed 's/v//')
  MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [ "$MAJOR" -ge 18 ]; then
    ok "Node.js v$NODE_VER"
  else
    fail "Node.js v$NODE_VER found but >= 18 required. Install a newer version (https://nodejs.org or via nvm)."
  fi
else
  fail "Node.js not found. Install from https://nodejs.org or via nvm."
fi

# ── npm ───────────────────────────────────────────────────────────────────────
if command -v npm &>/dev/null; then
  ok "npm $(npm --version)"
else
  fail "npm not found. It normally ships with Node.js."
fi

# ── node_modules installed ────────────────────────────────────────────────────
if [ -d "$DIR/node_modules/electron" ]; then
  ok "node_modules present"
else
  warn "node_modules missing — running npm install..."
  npm install
  ok "npm install completed"
fi

# ── Electron binary ───────────────────────────────────────────────────────────
ELECTRON_BIN="$DIR/node_modules/electron/dist/electron"
if [ -f "$ELECTRON_BIN" ] && [ -x "$ELECTRON_BIN" ]; then
  ok "Electron binary present"
else
  warn "Electron binary missing — attempting to download..."
  # Try install script first
  node "$DIR/node_modules/electron/install.js" 2>/dev/null || true
  if [ ! -f "$ELECTRON_BIN" ]; then
    # Fall back to unzip from cache if available
    CACHE_ZIP=$(find ~/.cache/electron -name "electron-*-linux-x64.zip" 2>/dev/null | sort -V | tail -1)
    if [ -n "$CACHE_ZIP" ]; then
      warn "Using cached zip: $CACHE_ZIP"
      unzip -o "$CACHE_ZIP" -d "$DIR/node_modules/electron/dist/" >/dev/null 2>&1
      printf "electron" > "$DIR/node_modules/electron/path.txt"
    fi
  fi
  if [ -f "$ELECTRON_BIN" ] && [ -x "$ELECTRON_BIN" ]; then
    ok "Electron binary ready"
  else
    fail "Electron binary could not be installed. Try: npm install --force"
  fi
fi

# ── Display server (Linux only) ───────────────────────────────────────────────
if [ "$(uname)" = "Linux" ]; then
  if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
    ok "Display server detected (${WAYLAND_DISPLAY:+Wayland}${DISPLAY:+X11})"
  else
    warn "No DISPLAY or WAYLAND_DISPLAY set. If running headless, the app may fail to open a window."
  fi
fi

# ── ELECTRON_RUN_AS_NODE must NOT be set ─────────────────────────────────────
if [ "${ELECTRON_RUN_AS_NODE:-}" = "1" ]; then
  warn "ELECTRON_RUN_AS_NODE=1 is set — this forces Electron to run as plain Node.js. Unsetting it."
  unset ELECTRON_RUN_AS_NODE
else
  ok "ELECTRON_RUN_AS_NODE not set"
fi

# ── bash available (for running .sh scripts) ─────────────────────────────────
if command -v bash &>/dev/null; then
  ok "bash $(bash --version | head -1 | awk '{print $4}')"
else
  warn "bash not found. Unix scripts (.sh) will fail to launch."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "  Passed: $PASS   Warnings: $WARN   Failed: $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "Fix the above errors before launching."
  exit 1
fi

echo "Starting Multi Script Manager..."
echo ""
exec "$DIR/node_modules/.bin/electron" "$DIR"
