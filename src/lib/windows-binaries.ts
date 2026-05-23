import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveFromModule } from './paths.js';

/**
 * Path to the bundled Windows binaries directory, resolved relative to this
 * module's location at runtime. After build, this module lives in
 * `dist/lib/windows-binaries.js`, so `../../vendor/win32` lands at
 * `<package-root>/vendor/win32`.
 *
 * NOTE: directory is named `vendor/win32` (not `bin/win32`) deliberately —
 * npm's handling of the `bin` field interacts badly with a same-named `bin/`
 * directory on Windows during global install (the subdir gets dropped),
 * so we keep our bundled tools out of the conventional `bin/` slot.
 */
const WIN_BIN_DIR = resolveFromModule(import.meta.url, '..', '..', 'vendor', 'win32');

function bundled(name: string): string | null {
  if (process.platform !== 'win32') return null;
  const p = join(WIN_BIN_DIR, name);
  return existsSync(p) ? p : null;
}

/**
 * Absolute path to a bundled rsync.exe (with its msys DLLs alongside),
 * or null if not bundled / not on Windows.
 */
export function bundledRsync(): string | null {
  return bundled('rsync.exe');
}

/**
 * Absolute path to a bundled BusyBox-w64 executable, which provides `awk`
 * via `busybox.exe awk -f script input`. Returns null off-Windows.
 */
export function bundledBusybox(): string | null {
  return bundled('busybox.exe');
}
