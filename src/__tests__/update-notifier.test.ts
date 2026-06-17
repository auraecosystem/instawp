import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config + output so the notifier logic is isolated (no real fetch needed
// when the cache is fresh).
const mockCache = { value: null as null | { lastCheck: number; latestVersion: string } };
vi.mock('../lib/config.js', () => ({
  getUpdateCheck: () => mockCache.value,
  setUpdateCheck: vi.fn(),
}));
vi.mock('../lib/output.js', () => ({
  isJsonMode: () => false,
}));

import { compareVersions, maybeNotifyUpdate } from '../lib/update-notifier.js';

describe('compareVersions', () => {
  it('orders prerelease numbers numerically (not lexically)', () => {
    expect(compareVersions('0.0.1-beta.22', '0.0.1-beta.9')).toBeGreaterThan(0);
    expect(compareVersions('0.0.1-beta.9', '0.0.1-beta.22')).toBeLessThan(0);
    expect(compareVersions('0.0.1-beta.22', '0.0.1-beta.22')).toBe(0);
  });
  it('treats a release as newer than its prerelease', () => {
    expect(compareVersions('0.0.1', '0.0.1-beta.99')).toBeGreaterThan(0);
  });
  it('compares core version components', () => {
    expect(compareVersions('0.1.0-beta.1', '0.0.9-beta.50')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.0.1-beta.22')).toBeGreaterThan(0);
  });
});

describe('maybeNotifyUpdate', () => {
  let writes: string[];
  let spy: ReturnType<typeof vi.spyOn>;
  const origTTY = process.stderr.isTTY;
  const origCI = process.env.CI;

  beforeEach(() => {
    writes = [];
    spy = vi.spyOn(process.stderr, 'write').mockImplementation(((s: string) => { writes.push(String(s)); return true; }) as any);
    (process.stderr as any).isTTY = true;       // pretend interactive
    delete process.env.CI;
    delete process.env.INSTAWP_NO_UPDATE_NOTIFIER;
    delete process.env.INSTAWP_AUTO_UPGRADE;
  });
  afterEach(() => {
    spy.mockRestore();
    (process.stderr as any).isTTY = origTTY;
    if (origCI !== undefined) process.env.CI = origCI;
    mockCache.value = null;
  });

  it('prints a banner when a newer version is cached', async () => {
    mockCache.value = { lastCheck: Date.now(), latestVersion: '0.0.1-beta.99' };
    await maybeNotifyUpdate('0.0.1-beta.22');
    const out = writes.join('');
    expect(out).toContain('Update available');
    expect(out).toContain('0.0.1-beta.99');
    expect(out).toContain('instawp upgrade');
  });

  it('says nothing when already on the latest', async () => {
    mockCache.value = { lastCheck: Date.now(), latestVersion: '0.0.1-beta.22' };
    await maybeNotifyUpdate('0.0.1-beta.22');
    expect(writes.join('')).toBe('');
  });

  it('is silent when suppressed (CI / non-TTY / env)', async () => {
    mockCache.value = { lastCheck: Date.now(), latestVersion: '0.0.1-beta.99' };
    process.env.INSTAWP_NO_UPDATE_NOTIFIER = '1';
    await maybeNotifyUpdate('0.0.1-beta.22');
    expect(writes.join('')).toBe('');
  });
});
