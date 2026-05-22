#!/usr/bin/env bash
# Fetches the Windows binaries that ship in the npm package:
#   - busybox.exe  (provides `awk` for mysql2sqlite)
#   - rsync.exe + msys-*.dll runtime deps  (for sync/push/pull/clone)
#
# Sources:
#   - BusyBox-w64 from https://frippery.org/busybox/ (GPL-2.0)
#   - rsync and msys2-runtime DLLs from MSYS2 official repo
#     https://repo.msys2.org/msys/x86_64/ (mixed FOSS licenses)
#
# Run this once before publishing. Binaries land in bin/win32/ and should be
# committed to git so they ship in the npm tarball.
#
# Requires: curl, tar, zstd (macOS: `brew install zstd`).
#
# To bump versions, edit the constants below or set them via env:
#   RSYNC_VER=3.4.0-1 bash scripts/fetch-windows-binaries.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$REPO_ROOT/bin/win32"
MSYS_BASE="https://repo.msys2.org/msys/x86_64"

# Pinned versions (update by browsing the MSYS2 index)
RSYNC_VER="${RSYNC_VER:-3.4.0-1}"
RUNTIME_VER="${RUNTIME_VER:-3.3-3.3.6-11}"
OPENSSL_VER="${OPENSSL_VER:-3.3.2-1}"
ICONV_VER="${ICONV_VER:-1.17-1}"
LZ4_VER="${LZ4_VER:-1.10.0-1}"
XXHASH_VER="${XXHASH_VER:-0.8.2-1}"
ZSTD_VER="${ZSTD_VER:-1.5.6-1}"

# Package → DLL/exe file we want from it
declare -a PACKAGES=(
  "rsync-${RSYNC_VER}             usr/bin/rsync.exe"
  "msys2-runtime-${RUNTIME_VER}   usr/bin/msys-2.0.dll"
  "libopenssl-${OPENSSL_VER}      usr/bin/msys-crypto-3.dll"
  "libiconv-${ICONV_VER}          usr/bin/msys-iconv-2.dll"
  "liblz4-${LZ4_VER}              usr/bin/msys-lz4-1.dll"
  "libxxhash-${XXHASH_VER}        usr/bin/msys-xxhash-0.dll"
  "libzstd-${ZSTD_VER}            usr/bin/msys-zstd-1.dll"
)

for cmd in curl tar zstd; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: $cmd not found." >&2
    if [[ "$cmd" == "zstd" ]] && [[ "$(uname)" == "Darwin" ]]; then
      echo "Install with: brew install zstd" >&2
    fi
    exit 1
  fi
done

mkdir -p "$BIN_DIR"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "==> BusyBox-w64 (awk provider)"
# busybox64u.exe = 64-bit UCRT build (Windows 10+, modern Microsoft C runtime).
# Node 18+ already requires Windows 10, so this matches.
curl -fL --progress-bar -o "$BIN_DIR/busybox.exe" \
  "https://frippery.org/files/busybox/busybox64u.exe"

echo
echo "==> MSYS2 packages → rsync.exe + DLLs"
for entry in "${PACKAGES[@]}"; do
  # Split by whitespace into name + path
  read -r pkg path <<< "$entry"
  url="$MSYS_BASE/${pkg}-x86_64.pkg.tar.zst"
  archive="$TMPDIR/${pkg}.pkg.tar.zst"
  echo "  - $pkg"
  curl -fL --silent -o "$archive" "$url"
  # Extract just the file we care about
  zstd -d "$archive" -c | tar -xf - -C "$TMPDIR" "$path"
  cp "$TMPDIR/$path" "$BIN_DIR/"
done

echo
echo "==> Done. Bundle contents:"
ls -lh "$BIN_DIR"
echo
echo "Total size: $(du -sh "$BIN_DIR" | cut -f1)"
echo
echo "Next: git add bin/win32 && git commit -m 'chore: refresh Windows binaries'"
