# Bundled Windows binaries

Files in this directory are third-party binaries bundled into the npm package
so that `instawp local clone`, `instawp local push/pull`, and `instawp sync`
work on Windows without requiring users to install rsync, awk, or sqlite3.

Populate this directory by running `scripts/fetch-windows-binaries.sh`.

## Components and licenses

### busybox.exe
- **Source**: BusyBox-w64 by Ron Yorston — https://frippery.org/busybox/
- **License**: GPL-2.0
- **Used for**: provides `awk` (invoked as `busybox.exe awk -f ...`) for
  converting MySQL dumps to SQLite via the vendored `scripts/mysql2sqlite`
  awk script.

### rsync.exe + msys-*.dll
- **Source**: Git for Windows portable distribution — https://gitforwindows.org/
- **License**: rsync is GPL-3.0; msys2-runtime DLLs are mixed (mostly LGPL/MIT)
- **Used for**: file sync between local and remote sites in `sync push/pull`
  and `local push/pull/clone`.

The `msys-2.0.dll` and other `msys-*.dll` files must remain colocated with
rsync.exe — rsync.exe links against them at runtime.

## License compliance

The CLI is MIT-licensed, but the bundled GPL binaries impose obligations on
**redistribution**:

- Users who receive the binaries are entitled to the corresponding source.
- BusyBox source: https://busybox.net/downloads/
- rsync source: https://download.samba.org/pub/rsync/src/
- Git for Windows source: https://github.com/git-for-windows/git

The maintainer's responsibility is to keep this NOTICE.md shipped alongside
the binaries in the npm tarball.
