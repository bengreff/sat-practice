#!/usr/bin/env bash
# SAT Practice installer for macOS and Linux.
#   curl -fsSL https://raw.githubusercontent.com/bengreff/sat-practice/main/install.sh | bash
# Installs (or updates) the app in ~/SATPractice, adds a launcher, and starts it.
# Your progress (progress.json, backups/) is never touched by an update.
set -euo pipefail

REPO="bengreff/sat-practice"
DEST="${SAT_PRACTICE_DIR:-$HOME/SATPractice}"
SRC="${SAT_PRACTICE_TARBALL:-https://codeload.github.com/$REPO/tar.gz/refs/heads/main}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }

# 1. Python 3
PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 8))' >/dev/null 2>&1; then PY="$(command -v "$c")"; break; fi
done
if [ -z "$PY" ]; then
  say "Python 3.8+ is needed."
  if [ "$(uname)" = "Darwin" ]; then
    echo "Installing Apple's command line tools (they include Python 3). Accept the dialog, then run this installer again."
    xcode-select --install 2>/dev/null || true
  else
    echo "Install it with your package manager, e.g.  sudo apt install python3   or   sudo dnf install python3"
  fi
  exit 1
fi

# 2. Download and install/update the app files
say "Downloading SAT Practice…"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$SRC" | tar -xz -C "$TMP"
SRCDIR="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
mkdir -p "$DEST"
cp -R "$SRCDIR"/. "$DEST"/
chmod +x "$DEST/install.sh" 2>/dev/null || true

# 3. Launcher
if [ "$(uname)" = "Darwin" ]; then
  LAUNCHER="$HOME/Desktop/SAT Practice.command"
  printf '#!/bin/bash\ncd "%s" && exec "%s" server.py\n' "$DEST" "$PY" > "$LAUNCHER"
  chmod +x "$LAUNCHER"
  say "Launcher: Desktop › SAT Practice.command (double-click to start)"
else
  APPS="$HOME/.local/share/applications"; mkdir -p "$APPS"
  cat > "$APPS/sat-practice.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=SAT Practice
Exec=sh -c 'cd "$DEST" && "$PY" server.py'
Terminal=true
Icon=$DEST/icon.svg
EOF
  [ -d "$HOME/Desktop" ] && cp "$APPS/sat-practice.desktop" "$HOME/Desktop/" && chmod +x "$HOME/Desktop/sat-practice.desktop" || true
  say "Launcher: 'SAT Practice' in your applications menu"
fi

# 4. Start it (the server opens your browser; a copy that is already running is reused)
say "Installed in $DEST. Starting…"
cd "$DEST"
if [ "${SAT_PRACTICE_NO_START:-}" = "1" ]; then exit 0; fi
nohup "$PY" server.py > "$DEST/server.log" 2>&1 &
sleep 2
grep -m1 -E 'SAT Practice at|Already running' "$DEST/server.log" || echo "Started. If no browser opened, see $DEST/server.log"
