#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FULL=0
for arg in "$@"; do
  [ "$arg" = "--full" ] && FULL=1
done

echo ""
echo "Multi Script Manager — cleanup"
echo "==============================="

remove() {
  local path="$DIR/$1"
  if [ -e "$path" ]; then
    rm -rf "$path"
    echo "  Removed: $1"
  fi
}

remove "bin"
remove "electron-dist"
remove "dist"
remove "out"

if [ "$FULL" -eq 1 ]; then
  remove "node_modules"
  echo ""
  echo "  Full cleanup done. Run start.sh to reinstall dependencies."
else
  echo ""
  echo "  Done. Pass --full to also remove node_modules."
fi

echo ""
