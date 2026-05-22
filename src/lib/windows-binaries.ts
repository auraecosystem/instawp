import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveFromModule } from './paths.js';

/**
 * Path to the bundled Windows binaries directory, resolved relative to this
 * module's location at runtime. After build, this module lives in
 * `dist/lib/windows-binaries.js`, so `../../bin/win32` lands at
 * `<package-root>/bin/win32`.
 */
const WIN_BIN_DIR = resolveFromModule(import.meta.url, '..', '..', 'bin', 'win32');

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
