import { describe, it, expect, vi, afterEach } from 'vitest';
import { toRsyncPath, resolveFromModule } from '../lib/paths.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockPlatform(p: NodeJS.Platform): void {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(p);
}

describe('toRsyncPath', () => {
  it('is a no-op on non-Windows', () => {
    mockPlatform('darwin');
    expect(toRsyncPath('/Users/vikas/foo')).toBe('/Users/vikas/foo');
    expect(toRsyncPath('./wp-content/')).toBe('./wp-content/');
  });

  it('converts a Windows drive path to msys style', () => {
    mockPlatform('win32');
    expect(toRsyncPath('C:\\Users\\vikas\\wp-content\\')).toBe('/c/Users/vikas/wp-content/');
    expect(toRsyncPath('D:\\some\\path')).toBe('/d/some/path');
  });

  it('accepts forward-slash drive paths too', () => {
    mockPlatform('win32');
    expect(toRsyncPath('C:/Users/vikas')).toBe('/c/Users/vikas');
  });

  it('passes remote user@host: specs through unchanged', () => {
    mockPlatform('win32');
    expect(toRsyncPath('runcloud@example.com:/home/runcloud/web'))
      .toBe('runcloud@example.com:/home/runcloud/web');
  });

  it('normalizes UNC-style separators on Windows', () => {
    mockPlatform('win32');
    expect(toRsyncPath('\\\\server\\share\\path')).toBe('//server/share/path');
  });

  it('preserves trailing slash (matters for rsync semantics)', () => {
    mockPlatform('win32');
    expect(toRsyncPath('C:\\foo\\bar\\')).toBe('/c/foo/bar/');
  });
});

describe('resolveFromModule', () => {
  it('resolves paths relative to the importing module', () => {
    const fakeModuleUrl = 'file:///Users/vikas/Playground/repos/cli/dist/commands/local.js';
    const result = resolveFromModule(fakeModuleUrl, '..', '..', 'scripts', 'mysql2sqlite');
    expect(result).toBe('/Users/vikas/Playground/repos/cli/scripts/mysql2sqlite');
  });
});
