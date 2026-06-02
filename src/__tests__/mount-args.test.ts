import { describe, it, expect } from 'vitest';
import { buildMountArgs } from '../lib/local-env.js';

describe('buildMountArgs', () => {
  // macOS/Linux: long-standing colon form, unchanged.
  it('uses --mount=host:vfs on linux/macOS', () => {
    expect(buildMountArgs('/home/u/.instawp/local/x/wp-content', '/wordpress/wp-content', { platform: 'linux' }))
      .toEqual(['--mount=/home/u/.instawp/local/x/wp-content:/wordpress/wp-content']);
    expect(buildMountArgs('/Users/u/x/file.php', '/wordpress/file.php', { platform: 'darwin' }))
      .toEqual(['--mount=/Users/u/x/file.php:/wordpress/file.php']);
  });

  it('uses --mount-before-install=host:vfs on linux/macOS when beforeInstall', () => {
    expect(buildMountArgs('/Users/u/x/wp-content', '/wordpress/wp-content', { platform: 'darwin', beforeInstall: true }))
      .toEqual(['--mount-before-install=/Users/u/x/wp-content:/wordpress/wp-content']);
  });

  // Windows: separate-arg form (nargs:2) so the drive-letter colon in the host
  // path does not break Playground's split(':') parser. Regression test for the
  // "Invalid mount format: C:\...\wp-content:/wordpress/wp-content" bug.
  it('uses --mount-dir with separate args on Windows (no colon-joined host:vfs)', () => {
    const args = buildMountArgs('C:\\Users\\u\\.instawp\\local\\x\\wp-content', '/wordpress/wp-content', { platform: 'win32' });
    expect(args).toEqual(['--mount-dir', 'C:\\Users\\u\\.instawp\\local\\x\\wp-content', '/wordpress/wp-content']);
    // The host path must never be colon-joined with the vfs path on Windows.
    expect(args.some(a => a.includes(':/wordpress'))).toBe(false);
  });

  it('uses --mount-dir-before-install on Windows when beforeInstall', () => {
    expect(buildMountArgs('C:\\Users\\u\\x\\wp-content', '/wordpress/wp-content', { platform: 'win32', beforeInstall: true }))
      .toEqual(['--mount-dir-before-install', 'C:\\Users\\u\\x\\wp-content', '/wordpress/wp-content']);
  });

  it('handles Windows file mounts the same separate-arg way', () => {
    expect(buildMountArgs('C:\\Users\\u\\x\\.htaccess', '/wordpress/.htaccess', { platform: 'win32' }))
      .toEqual(['--mount-dir', 'C:\\Users\\u\\x\\.htaccess', '/wordpress/.htaccess']);
  });
});
