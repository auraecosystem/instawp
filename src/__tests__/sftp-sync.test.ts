import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeMatcher, listLocalFiles } from '../lib/sftp-sync.js';

describe('sftp-sync exclude/include matcher', () => {
  it('matches exact names at any depth', () => {
    const m = makeMatcher(['node_modules', '.git', '.DS_Store']);
    expect(m('node_modules', 'plugins/foo/node_modules')).toBe(true);
    expect(m('.git', '.git')).toBe(true);
    expect(m('.DS_Store', 'themes/.DS_Store')).toBe(true);
    expect(m('index.php', 'index.php')).toBe(false);
  });

  it('supports * globs against the segment name', () => {
    const m = makeMatcher(['backup*', 'wp-*.php']);
    expect(m('backup', 'backup')).toBe(true);
    expect(m('backup-2024.zip', 'uploads/backup-2024.zip')).toBe(true);
    expect(m('wp-config.php', 'wp-config.php')).toBe(true);
    expect(m('config.php', 'config.php')).toBe(false);
  });

  it('anchors patterns that contain a slash to the relative path', () => {
    const m = makeMatcher(['wp-admin/', 'cache/data']);
    expect(m('wp-admin', 'wp-admin')).toBe(true);
    // a nested dir named wp-admin should NOT match an anchored root pattern
    expect(m('wp-admin', 'plugins/wp-admin')).toBe(false);
    expect(m('data', 'cache/data')).toBe(true);
  });

  it('does not match anything for an empty pattern list', () => {
    const m = makeMatcher([]);
    expect(m('anything', 'a/b/c')).toBe(false);
  });

  it('treats * as not crossing path separators', () => {
    const m = makeMatcher(['cache']);
    expect(m('cache', 'wp-content/cache')).toBe(true);
    expect(m('mycache', 'wp-content/mycache')).toBe(false);
  });
});

describe('listLocalFiles (push dry-run preview)', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('walks the tree, excludes matches, and never needs the network', () => {
    dir = mkdtempSync(join(tmpdir(), 'iwp-push-'));
    mkdirSync(join(dir, 'plugins', 'foo'), { recursive: true });
    mkdirSync(join(dir, 'database'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(dir, 'index.php'), '<?php');
    writeFileSync(join(dir, 'plugins', 'foo', 'foo.php'), '<?php');
    writeFileSync(join(dir, 'database', '.ht.sqlite'), 'x');     // excluded
    writeFileSync(join(dir, 'node_modules', 'x', 'y.js'), 'x');  // excluded

    const files = listLocalFiles(dir, ['database', 'db.php', 'mu-plugins', '.git', 'node_modules', '.DS_Store']).sort();

    expect(files).toContain('index.php');
    expect(files).toContain('plugins/foo/foo.php');
    expect(files.some(f => f.startsWith('database/'))).toBe(false);
    expect(files.some(f => f.startsWith('node_modules/'))).toBe(false);
    // forward-slash relative paths regardless of OS
    expect(files.every(f => !f.includes('\\'))).toBe(true);
  });

  it('returns [] for a missing directory', () => {
    expect(listLocalFiles(join(tmpdir(), 'iwp-does-not-exist-zzz'), [])).toEqual([]);
  });
});
