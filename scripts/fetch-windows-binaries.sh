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
BIN_DIR="$REPO_ROOT/vendor/win32"
MSYS_BASE="https://repo.msys2.org/msys/x86_64"

# Pinned versions (update by browsing the MSYS2 index).
#
# IMPORTANT: msys2-runtime must be the *current* rolling package (NOT the
# `msys2-runtime-3.3` legacy compat fork). Older runtimes (3.3.x) lack symbols
# like `fallocate` that newer rsync builds need, producing a runtime
# "entry point not found" error on Windows.
RSYNC_VER="${RSYNC_VER:-3.4.2-2}"
RUNTIME_VER="${RUNTIME_VER:-3.6.9-1}"
OPENSSL_VER="${OPENSSL_VER:-3.6.2-1}"
ICONV_VER="${ICONV_VER:-1.19-1}"
LZ4_VER="${LZ4_VER:-1.10.0-1}"
XXHASH_VER="${XXHASH_VER:-0.8.3-1}"
ZSTD_VER="${ZSTD_VER:-1.5.7-1}"
POPT_VER="${POPT_VER:-1.19-1}"
INTL_VER="${INTL_VER:-0.22.5-1}"

# Package → DLL/exe file we want from it
declare -a PACKAGES=(
  "rsync-${RSYNC_VER}             usr/bin/rsync.exe"
  "msys2-runtime-${RUNTIME_VER}   usr/bin/msys-2.0.dll"
  "libopenssl-${OPENSSL_VER}      usr/bin/msys-crypto-3.dll"
  "libiconv-${ICONV_VER}          usr/bin/msys-iconv-2.dll"
  "liblz4-${LZ4_VER}              usr/bin/msys-lz4-1.dll"
  "libxxhash-${XXHASH_VER}        usr/bin/msys-xxhash-0.dll"
  "libzstd-${ZSTD_VER}            usr/bin/msys-zstd-1.dll"
  "popt-${POPT_VER}               usr/bin/msys-popt-0.dll"
  "libintl-${INTL_VER}            usr/bin/msys-intl-8.dll"
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
echo "==> Verifying DLL closure (every referenced msys-*.dll is bundled)..."
missing=0
for f in "$BIN_DIR"/rsync.exe "$BIN_DIR"/msys-*.dll; do
  for ref in $(strings "$f" | grep -iE '^msys-.*\.dll$' | sort -u); do
    if [[ ! -f "$BIN_DIR/$ref" ]]; then
      echo "  ✗ $f references $ref but it's not bundled"
      missing=1
    fi
  done
done
if [[ $missing -ne 0 ]]; then
  echo "ERROR: DLL closure is incomplete. Add the missing packages to PACKAGES." >&2
  exit 1
fi
echo "  ✓ DLL closure verified"

echo
echo "==> Verifying critical symbols (fallocate must be in msys-2.0.dll)..."
# Capture into a var first — `strings | grep -q` under `pipefail` triggers
# SIGPIPE when grep matches early, causing a false negative.
syms=$(strings "$BIN_DIR/msys-2.0.dll")
if ! grep -q '^fallocate$' <<< "$syms"; then
  echo "ERROR: msys-2.0.dll is missing fallocate — likely the legacy msys2-runtime-3.3 fork." >&2
  echo "Set RUNTIME_VER to a current package like 3.6.9-1." >&2
  exit 1
fi
echo "  ✓ fallocate present"

echo
echo "==> Done. Bundle contents:"
ls -lh "$BIN_DIR"
echo
echo "Total size: $(du -sh "$BIN_DIR" | cut -f1)"
echo
echo "Next: git add vendor/win32 && git commit -m 'chore: refresh Windows binaries'"
