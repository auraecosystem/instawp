import { getClient } from './api.js';
import { error, info } from './output.js';
import type { SiteDetails } from '../types.js';

export async function resolveSite(identifier: string): Promise<SiteDetails> {
  const client = getClient();

  // If purely numeric, fetch directly by ID
  if (/^\d+$/.test(identifier)) {
    try {
      const res = await client.get(`/sites/${identifier}/details`);
      const data = res.data?.data;
      const site = data?.site || data;
      return normalizeSite(site, data);
    } catch (err: any) {
      if (err.response?.status === 404) {
        error(`No site found with ID ${identifier}. Use \`instawp sites list\` to see your sites.`);
      } else {
        error('Failed to fetch site details', err.response?.data?.message || err.message);
      }
      process.exit(1);
    }
  }

  // Otherwise, search by name/domain
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

    // Single match — fetch full details
    const match = matches[0];
    try {
      const detailRes = await client.get(`/sites/${match.id}/details`);
      const data = detailRes.data?.data;
      const site = data?.site || data;
      return normalizeSite(site, data);
    } catch {
      // Fall back to list data if details endpoint fails
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
