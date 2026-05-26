#!/usr/bin/env bash
# Fetches the one Windows binary that ships in the npm package:
#   - busybox.exe  (provides `awk` for the mysql2sqlite step in `local clone`)
#
# Source: BusyBox-w64 (busybox-w32) from https://frippery.org/busybox/ (GPL-2.0).
# It's a single statically-linked exe with no external DLL dependencies.
#
# NOTE: We used to bundle rsync.exe + the msys2 runtime DLLs here, but Windows
# file transfers now use a pure-JS SFTP client (src/lib/sftp-sync.ts) because
# msys rsync cannot drive native Windows OpenSSH. So busybox is all that's left.
#
# Run this once before publishing if you need to refresh busybox. The binary
# lands in vendor/win32/ and should be committed so it ships in the npm tarball.
#
# Requires: curl.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$REPO_ROOT/vendor/win32"

mkdir -p "$BIN_DIR"

echo "==> BusyBox-w64 (awk provider)"
# busybox64u.exe = 64-bit UCRT build (Windows 10+, modern Microsoft C runtime).
# Node 18+ already requires Windows 10, so this matches.
curl -fL --progress-bar -o "$BIN_DIR/busybox.exe" \
  "https://frippery.org/files/busybox/busybox64u.exe"

echo
echo "==> Verifying it runs awk..."
if command -v file >/dev/null 2>&1; then
  file "$BIN_DIR/busybox.exe"
fi

echo
echo "==> Done. Bundle contents:"
ls -lh "$BIN_DIR"
echo
echo "Next: git add vendor/win32 && git commit -m 'chore: refresh busybox'"
