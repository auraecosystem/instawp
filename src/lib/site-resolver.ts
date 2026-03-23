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

  // Search by name/domain
  try {
    const res = await client.get('/sites', { params: { per_page: 100 } });
    const sites: any[] = res.data?.data || [];

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
