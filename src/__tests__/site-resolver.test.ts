import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockGet = vi.fn();
vi.mock('../lib/api.js', () => ({
  getClient: () => ({ get: mockGet }),
}));

vi.mock('../lib/output.js', () => ({
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../lib/config.js', () => ({
  getSiteCache: vi.fn().mockReturnValue(null),
  setSiteCache: vi.fn(),
}));

// Mock process.exit to throw instead
vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:process')>();
  return { ...actual, default: actual };
});

const { resolveSite } = await import('../lib/site-resolver.js');

const mockExit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
  throw new Error(`process.exit(${code})`);
}) as any);

beforeEach(() => {
  mockGet.mockReset();
  mockExit.mockClear();
});

describe('site-resolver', () => {
  describe('resolve by numeric ID', () => {
    it('fetches site details directly by ID', async () => {
      mockGet.mockResolvedValue({
        data: {
          data: {
            site: { id: 123, name: 'my-site', sub_domain: 'my-site.example.com', url: 'https://my-site.example.com', status: 0, wp_version: '6.5', php_version: '8.2' },
          },
        },
      });

      const result = await resolveSite('123');
      expect(mockGet).toHaveBeenCalledWith('/sites/123/details');
      expect(result.id).toBe(123);
      expect(result.name).toBe('my-site');
    });

    it('exits with error when site ID not found (404)', async () => {
      mockGet.mockRejectedValue({ response: { status: 404 } });

      await expect(resolveSite('999')).rejects.toThrow();
    });

    it('exits with error on API failure', async () => {
      mockGet.mockRejectedValue({ response: { status: 500, data: { message: 'Server error' } } });

      await expect(resolveSite('123')).rejects.toThrow();
    });
  });

  describe('resolve by name/domain', () => {
    const sitesListResponse = {
      data: {
        data: [
          { id: 1, name: 'alpha', sub_domain: 'alpha.example.com', domain: { name: 'alpha.custom.com' }, url: 'https://alpha.example.com' },
          { id: 2, name: 'beta', sub_domain: 'beta.example.com', domain: null, url: 'https://beta.example.com' },
          { id: 3, name: 'gamma', sub_domain: 'gamma.example.com', domain: { name: 'gamma.io' }, url: 'https://gamma.io' },
        ],
      },
    };

    it('matches by site name (case-insensitive)', async () => {
      mockGet
        .mockResolvedValueOnce(sitesListResponse) // GET /sites
        .mockResolvedValueOnce({ data: { data: { site: { id: 2, name: 'beta', sub_domain: 'beta.example.com', url: '', status: 0, wp_version: '', php_version: '' } } } }); // GET /sites/2/details

      const result = await resolveSite('Beta');
      expect(mockGet).toHaveBeenCalledWith('/sites', { params: { per_page: 20, page: 1 } });
      expect(result.id).toBe(2);
      expect(result.name).toBe('beta');
    });

    it('paginates across pages to find a site beyond page 1 (issue #3)', async () => {
      // Page 1: 20 sites that do NOT match; meta says last_page 2.
      const page1 = {
        data: {
          data: Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, name: `filler-${i}`, sub_domain: `filler-${i}.example.com` })),
          meta: { last_page: 2, per_page: 20 },
        },
      };
      // Page 2: contains the target.
      const page2 = {
        data: {
          data: [{ id: 999, name: 'needle', sub_domain: 'needle.example.com', url: 'https://needle.example.com' }],
          meta: { last_page: 2, per_page: 20 },
        },
      };
      mockGet
        .mockResolvedValueOnce(page1) // GET /sites?page=1
        .mockResolvedValueOnce(page2) // GET /sites?page=2
        .mockResolvedValueOnce({ data: { data: { site: { id: 999, name: 'needle', sub_domain: 'needle.example.com', url: '', status: 0, wp_version: '', php_version: '' } } } }); // details

      const result = await resolveSite('needle');
      expect(mockGet).toHaveBeenNthCalledWith(1, '/sites', { params: { per_page: 20, page: 1 } });
      expect(mockGet).toHaveBeenNthCalledWith(2, '/sites', { params: { per_page: 20, page: 2 } });
      expect(result.id).toBe(999);
    });

    it('matches by sub_domain', async () => {
      mockGet
        .mockResolvedValueOnce(sitesListResponse)
        .mockResolvedValueOnce({ data: { data: { site: { id: 1, name: 'alpha', sub_domain: 'alpha.example.com', url: '', status: 0, wp_version: '', php_version: '' } } } });

      const result = await resolveSite('alpha.example.com');
      expect(result.id).toBe(1);
    });

    it('matches by custom domain', async () => {
      mockGet
        .mockResolvedValueOnce(sitesListResponse)
        .mockResolvedValueOnce({ data: { data: { site: { id: 3, name: 'gamma', sub_domain: 'gamma.example.com', url: '', status: 0, wp_version: '', php_version: '' } } } });

      const result = await resolveSite('gamma.io');
      expect(result.id).toBe(3);
    });

    it('exits when no match found', async () => {
      mockGet.mockResolvedValueOnce(sitesListResponse);

      await expect(resolveSite('nonexistent')).rejects.toThrow();
    });

    it('exits with disambiguation when multiple matches', async () => {
      const dupeList = {
        data: {
          data: [
            { id: 1, name: 'mysite', sub_domain: 'mysite-1.example.com', url: '' },
            { id: 2, name: 'mysite', sub_domain: 'mysite-2.example.com', url: '' },
          ],
        },
      };
      mockGet.mockResolvedValueOnce(dupeList);

      await expect(resolveSite('mysite')).rejects.toThrow();
    });

    it('falls back to list data when details endpoint fails', async () => {
      mockGet
        .mockResolvedValueOnce(sitesListResponse)
        .mockRejectedValueOnce(new Error('details 500'));

      const result = await resolveSite('alpha');
      expect(result.id).toBe(1);
      expect(result.name).toBe('alpha');
    });
  });

  describe('normalizeSite', () => {
    it('handles missing optional fields', async () => {
      mockGet.mockResolvedValue({
        data: { data: { site: { id: 1 } } },
      });

      const result = await resolveSite('1');
      expect(result).toEqual({
        id: 1,
        name: '',
        sub_domain: '',
        url: '',
        status: 0,
        wp_version: '',
        php_version: '',
        domain: undefined,
        server_username: '',
        main_domain: '',
      });
    });
  });
});
