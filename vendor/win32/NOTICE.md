# Bundled Windows binary

`busybox.exe` is bundled into the npm package so that `instawp local clone`
works on Windows without requiring the user to install `awk`.

Populate/refresh it with `scripts/fetch-windows-binaries.sh`.

## Component and license

### busybox.exe
- **Source**: BusyBox-w64 by Ron Yorston — https://frippery.org/busybox/
- **License**: GPL-2.0
- **Used for**: provides `awk` (invoked as `busybox.exe awk -f ...`) for
  converting MySQL dumps to SQLite via the vendored `scripts/mysql2sqlite`
  awk script.
- Statically linked; no external DLL dependencies.

## Why no rsync here

Earlier betas bundled `rsync.exe` + the msys2 runtime DLLs for file sync.
That was removed: msys rsync cannot drive native Windows OpenSSH (incompatible
pipe/signal semantics → "connection unexpectedly closed"). Windows file
transfers now use a pure-JS SFTP client (`src/lib/sftp-sync.ts`) instead, which
needs no native binaries.

## License compliance

BusyBox is GPL-2.0. Recipients of the binary are entitled to its source:
https://busybox.net/downloads/ (and the busybox-w32 port at
https://frippery.org/busybox/). Keep this NOTICE.md shipped alongside the
binary in the npm tarball.
