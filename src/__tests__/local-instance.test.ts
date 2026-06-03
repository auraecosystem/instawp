import { describe, it, expect } from 'vitest';
import { sanitizeName, defaultInstanceName, pushTargetRef } from '../lib/local-instance.js';

describe('sanitizeName', () => {
  it('lowercases and replaces non [a-z0-9_-] with -', () => {
    expect(sanitizeName('Client Store 1234')).toBe('client-store-1234');
    expect(sanitizeName('foo.instawp.site')).toBe('foo-instawp-site');
    expect(sanitizeName('Keep_me-1')).toBe('keep_me-1');
  });
});

describe('defaultInstanceName', () => {
  it('prefers the site name when present', () => {
    expect(defaultInstanceName({ id: 1, name: 'My Site', sub_domain: 'x.instawp.site' })).toBe('my-site');
  });

  it('uses the first DNS label of the subdomain when name is empty (the bug fix)', () => {
    // Previously sanitized the whole domain → "client-store-1234-instawp-site".
    expect(defaultInstanceName({ id: 1, name: '', sub_domain: 'client-store-1234.instawp.site' }))
      .toBe('client-store-1234');
  });

  it('handles a bare subdomain with no dots', () => {
    expect(defaultInstanceName({ id: 1, sub_domain: 'client-store-1234' })).toBe('client-store-1234');
  });

  it('falls back to site-<id> when nothing usable', () => {
    expect(defaultInstanceName({ id: 42, name: '', sub_domain: '' })).toBe('site-42');
  });
});

describe('pushTargetRef', () => {
  it('prefers an explicit cloud-site argument', () => {
    expect(pushTargetRef('other-site', { cloudSiteId: 99 })).toBe('other-site');
  });

  it('falls back to the cloned origin site id when no arg', () => {
    expect(pushTargetRef(undefined, { cloudSiteId: 2510661 })).toBe('2510661');
  });

  it('returns undefined (caller creates) when no arg and not a cloned instance', () => {
    expect(pushTargetRef(undefined, {})).toBeUndefined();
  });

  it('treats a blank arg as no arg, deferring to the origin', () => {
    expect(pushTargetRef('   ', { cloudSiteId: 7 })).toBe('7');
    expect(pushTargetRef('  ', {})).toBeUndefined();
  });
});
