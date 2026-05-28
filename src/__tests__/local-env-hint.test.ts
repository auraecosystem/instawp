import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { maybeShowNpxHint, _resetNpxHint } from '../lib/local-env.js';
import { setJsonMode } from '../lib/output.js';

let writes: string[];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  writes = [];
  _resetNpxHint();
  setJsonMode(false);
  spy = vi.spyOn(process.stderr, 'write').mockImplementation(((s: string) => { writes.push(s); return true; }) as any);
});

afterEach(() => {
  spy.mockRestore();
  setJsonMode(false);
});

describe('maybeShowNpxHint', () => {
  it('shows the hint on the npx path', () => {
    maybeShowNpxHint(true);
    const out = writes.join('');
    expect(out).toContain('not found globally');
    expect(out).toContain('npm i -g @wp-playground/cli');
  });

  it('does NOT show when the global binary is used', () => {
    maybeShowNpxHint(false);
    expect(writes.join('')).toBe('');
  });

  it('is suppressed in --json mode', () => {
    setJsonMode(true);
    maybeShowNpxHint(true);
    expect(writes.join('')).toBe('');
  });

  it('shows at most once per process', () => {
    maybeShowNpxHint(true);
    maybeShowNpxHint(true);
    const count = writes.join('').split('not found globally').length - 1;
    expect(count).toBe(1);
  });
});
