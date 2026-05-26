import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn() };
});

import { existsSync } from 'node:fs';

const mockExists = existsSync as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  mockExists.mockReset();
});

beforeEach(() => {
  vi.resetModules();
});

function mockPlatform(p: NodeJS.Platform): void {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(p);
}

describe('windows-binaries', () => {
  it('returns null on non-Windows regardless of file presence', async () => {
    mockPlatform('darwin');
    mockExists.mockReturnValue(true);
    const { bundledBusybox } = await import('../lib/windows-binaries.js');
    expect(bundledBusybox()).toBeNull();
  });

  it('returns null on Windows when busybox is absent', async () => {
    mockPlatform('win32');
    mockExists.mockReturnValue(false);
    const { bundledBusybox } = await import('../lib/windows-binaries.js');
    expect(bundledBusybox()).toBeNull();
  });

  it('returns the path on Windows when busybox is present', async () => {
    mockPlatform('win32');
    mockExists.mockReturnValue(true);
    const { bundledBusybox } = await import('../lib/windows-binaries.js');
    expect(bundledBusybox()).toMatch(/busybox\.exe$/);
  });
});
