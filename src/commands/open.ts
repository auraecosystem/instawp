import { Command } from 'commander';
import { spawn } from 'child_process';
import { requireAuth, getClient } from '../lib/api.js';
import { getApiUrl } from '../lib/config.js';
import { resolveSite } from '../lib/site-resolver.js';
import { success, error, spinner, isJsonMode } from '../lib/output.js';

function openInBrowser(url: string): void {
  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

export function registerOpenCommand(program: Command): void {
  program
    .command('open <site>')
    .description('Open a site in your default browser')
    .option('--admin', 'Open the WordPress admin (/wp-admin) instead of the homepage')
    .option('--magic', 'Open the magic login URL (auto-logged-in admin session)')
    .option('-p, --print', 'Print the URL to stdout instead of opening it')
    .action(async (siteIdentifier: string, opts) => {
      if (opts.admin && opts.magic) {
        error('--admin and --magic are mutually exclusive. Pick one.');
        process.exit(1);
      }

      requireAuth();

      const spin = spinner('Resolving site...');
      spin.start();

      let url = '';
      let type: 'site' | 'admin' | 'magic' = 'site';

      try {
        const site = await resolveSite(siteIdentifier);
        const client = getClient();

        // Fetch full details to get site_meta and hash (needed for magic URL)
        const detailRes = await client.get(`/sites/${site.id}/details`);
        const siteData = detailRes.data?.data;
        const siteInfo = siteData?.site || siteData;
        const meta = siteInfo?.site_meta || siteData?.site_meta || {};

        const siteUrl = siteInfo?.url || site.url || '';
        const domain = siteInfo?.main_domain || siteInfo?.sub_domain
          || siteInfo?.domain?.name || siteInfo?.domain
          || siteData?.domain?.name || siteData?.domain || '';
        const baseUrl = siteUrl || (domain ? `https://${domain}` : '');

        if (opts.magic) {
          // Try details first, fall back to list endpoint for credentials
          let creds = meta;
          if (!creds.wp_magic_login_url) {
            try {
              const listRes = await client.get('/sites', { params: { per_page: 50 } });
              const match = (listRes.data?.data || []).find((s: any) => s.id === site.id);
              if (match?.site_meta?.wp_magic_login_url) creds = match.site_meta;
            } catch { /* ignore */ }
          }

          const magicUrl = creds.wp_magic_login_url
            || (siteInfo?.hash ? `${getApiUrl()}/wordpress-auto-login?site=${siteInfo.hash}` : '');

          if (!magicUrl) {
            spin.stop();
            error('No magic login URL available for this site.');
            process.exit(1);
          }

          url = magicUrl;
          type = 'magic';
        } else if (opts.admin) {
          if (!baseUrl) {
            spin.stop();
            error('Could not determine site URL.');
            process.exit(1);
          }
          url = `${baseUrl.replace(/\/$/, '')}/wp-admin`;
          type = 'admin';
        } else {
          if (!baseUrl) {
            spin.stop();
            error('Could not determine site URL.');
            process.exit(1);
          }
          url = baseUrl;
          type = 'site';
        }

        spin.stop();
      } catch (err: any) {
        spin.stop();
        error('Failed to resolve site', err.response?.data?.message || err.message);
        process.exit(1);
      }

      if (opts.print) {
        console.log(url);
        return;
      }

      if (isJsonMode()) {
        success('Opening URL', { url, type });
        return;
      }

      openInBrowser(url);
      success(`Opening ${url}`);
    });
}
