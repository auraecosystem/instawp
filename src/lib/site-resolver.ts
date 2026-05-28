import { getClient } from './api.js';
import { getSiteCache, setSiteCache } from './config.js';
import { error, info } from './output.js';
import type { SiteDetails } from '../types.js';

async function fetchSiteById(client: any, id: string | number): Promise<SiteDetails> {
  const res = await client.get(`/sites/${id}/details`);
  const data = res.data?.data;
  const site = data?.site || data;
  return normalizeSite(site, data);
}

/**
 * Fetch all sites by walking pagination. Uses a conservative per_page (20) and
 * follows meta.last_page rather than relying on a single large page — robust
 * for accounts with many sites and resilient to the API returning fewer rows
 * than requested for large per_page values (see issue #3). Mirrors how
 * `sites list` paginates.
 */
async function fetchAllSites(client: any): Promise<any[]> {
  const PER_PAGE = 20;
  const MAX_PAGES = 100; // safety cap (~2000 sites); resolve by ID beyond that
  const all: any[] = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const res = await client.get('/sites', { params: { per_page: PER_PAGE, page } });
    const items: any[] = res.data?.data || [];
    all.push(...items);
    const lastPage = Number(res.data?.meta?.last_page) || page;
    if (page >= lastPage || items.length === 0) break;
    page++;
  }
  return all;
}

export async function resolveSite(identifier: string): Promise<SiteDetails> {
  const client = getClient();

  // If purely numeric, fetch directly by ID
  if (/^\d+$/.test(identifier)) {
    try {
      return await fetchSiteById(client, identifier);
    } catch (err: any) {
      if (err.response?.status === 404) {
        error(`No site found with ID ${identifier}. Use \`instawp sites list\` to see your sites.`);
      } else {
        error('Failed to fetch site details', err.response?.data?.message || err.message);
      }
      process.exit(1);
    }
  }

  // Check cache for name/domain → ID mapping
  const cachedId = getSiteCache(identifier);
  if (cachedId) {
    try {
      return await fetchSiteById(client, cachedId);
    } catch (err: any) {
      // Cache stale (site deleted?), fall through to fresh lookup
      if (err.response?.status !== 404) throw err;
    }
  }

  // Search by name/domain — paginate through all sites
  try {
    const sites: any[] = await fetchAllSites(client);

    const needle = identifier.toLowerCase();
    const matches = sites.filter((s: any) => {
      const name = (s.name || '').toLowerCase();
      const subDomain = (s.sub_domain || '').toLowerCase();
      const domainName = (s.domain?.name || '').toLowerCase();
      return name === needle || subDomain === needle || domainName === needle;
    });

    if (matches.length === 0) {
      error(`No site found matching '${identifier}'. Use \`instawp sites list\` to see your sites.`);
      process.exit(1);
    }

    if (matches.length > 1) {
      error(`Multiple sites match '${identifier}':`);
      for (const s of matches) {
        info(`  ID ${s.id}: ${s.name || s.sub_domain} (${s.url || s.domain?.name || s.sub_domain})`);
      }
      info('Use the site ID to be specific.');
      process.exit(1);
    }

    // Single match — cache the mapping and fetch full details
    const match = matches[0];
    setSiteCache(identifier, match.id);

    try {
      const details = await fetchSiteById(client, match.id);
      // Also cache by name and domain for future lookups
      if (match.name) setSiteCache(match.name, match.id);
      if (match.sub_domain) setSiteCache(match.sub_domain, match.id);
      if (match.domain?.name) setSiteCache(match.domain.name, match.id);
      return details;
    } catch {
      return normalizeSite(match, match);
    }
  } catch (err: any) {
    error('Failed to search sites', err.response?.data?.message || err.message);
    process.exit(1);
  }
}

function normalizeSite(site: any, raw: any): SiteDetails {
  return {
    id: site.id,
    name: site.name || '',
    sub_domain: site.sub_domain || site.main_domain || raw?.sub_domain || '',
    url: site.url || '',
    status: site.status ?? 0,
    wp_version: site.wp_version || '',
    php_version: site.php_version || '',
    domain: site.domain || raw?.domain,
    server_username: site.server_username || raw?.server_username || '',
    main_domain: site.main_domain || raw?.main_domain || '',
  };
}
