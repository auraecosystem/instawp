import { Command } from 'commander';
import chalk from 'chalk';
import { requireAuth, getClient } from '../lib/api.js';
import { success, error, table, spinner, info, isJsonMode } from '../lib/output.js';

export function registerSitesCommand(program: Command): void {
  const sites = program
    .command('sites')
    .description('Manage WordPress sites');

  // sites list
  sites
    .command('list')
    .description('List all sites')
    .option('--status <status>', 'Filter by status')
    .option('--page <page>', 'Page number', '1')
    .option('--per-page <count>', 'Results per page', '20')
    .action(async (opts) => {
      requireAuth();
      const spin = spinner('Fetching sites...');
      spin.start();

      try {
        const client = getClient();
        const params: Record<string, any> = {
          page: parseInt(opts.page),
          per_page: parseInt(opts.perPage),
        };
        if (opts.status) params.status = opts.status;

        const res = await client.get('/sites', { params });
        spin.stop();

        const sites = res.data?.data || [];
        if (sites.length === 0) {
          if (isJsonMode()) {
            console.log(JSON.stringify([]));
          } else {
            info('No sites found.');
          }
          return;
        }

        const rows = sites.map((s: any) => ({
          id: s.id,
          name: s.name || '',
          domain: s.domain?.name || s.sub_domain || '',
          url: s.url || '',
          status: s.status === 0 ? 'Active' : s.is_expired ? 'Expired' : s.status || 'Unknown',
          wp_version: s.wp_version || '',
          php_version: s.php_version || '',
          created_at: s.created_at || '',
        }));

        table(['ID', 'Name', 'URL', 'Status', 'WP Version', 'PHP Version'], rows);
      } catch (err: any) {
        spin.fail('Failed to fetch sites');
        error('Could not list sites', err.response?.data?.message || err.message);
        process.exit(1);
      }
    });

  // sites create
  sites
    .command('create')
    .description('Create a new WordPress site')
    .requiredOption('--name <name>', 'Site name')
    .option('--php <version>', 'PHP version (e.g., 8.2)')
    .option('--config <id>', 'Configuration ID')
    .option('--no-wait', 'Do not wait for site to become active')
    .action(createSiteAction);

  // sites delete
  sites
    .command('delete <id>')
    .description('Delete a site')
    .option('--force', 'Skip confirmation')
    .action(async (id, opts) => {
      requireAuth();

      if (!opts.force) {
        if (isJsonMode()) {
          error('Use --force flag to delete in JSON mode');
          process.exit(1);
        }

        // Interactive confirmation
        const readline = await import('node:readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Are you sure you want to delete site ${id}? (y/N) `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          info('Cancelled.');
          return;
        }
      }

      const spin = spinner(`Deleting site ${id}...`);
      spin.start();

      try {
        const client = getClient();
        await client.delete(`/sites/${id}`);
        spin.succeed(`Site ${id} deleted`);
        success(`Site ${id} has been deleted`);
      } catch (err: any) {
        spin.fail('Failed to delete site');
        error('Could not delete site', err.response?.data?.message || err.message);
        process.exit(1);
      }
    });
}

// Shared create action used by both `sites create` and top-level `create`
async function createSiteAction(opts: any): Promise<void> {
  requireAuth();

  const json = isJsonMode();
  const startTime = Date.now();
  const elapsed = () => ((Date.now() - startTime) / 1000).toFixed(1);

  // Step indicator helpers for human mode
  const step = (msg: string) => { if (!json) console.log(chalk.green('\u2713') + ' ' + msg); };
  const heading = (msg: string) => { if (!json) console.log('\n' + chalk.dim('#') + ' ' + msg); };

  const spin = spinner('Submitting site request...');
  spin.start();

  try {
    const client = getClient();
    const payload: Record<string, any> = {
      site_name: opts.name,
    };
    if (opts.php) payload.php_version = opts.php;
    if (opts.config) payload.configuration_id = parseInt(opts.config);

    const res = await client.post('/sites', payload);
    const site = res.data?.data;

    if (!site?.id) {
      spin.fail('Site creation failed');
      error('Unexpected response from API', res.data);
      process.exit(1);
    }

    spin.stop();

    // If --no-wait or JSON mode without wait, return immediately
    if (!opts.wait) {
      if (json) {
        console.log(JSON.stringify({ success: true, data: { id: site.id, status: 'provisioning' } }));
      } else {
        success('Site creation initiated', {
          id: site.id,
          status: site.status || 'provisioning',
        });
        info('Use --wait to wait for provisioning (default). Pass --no-wait to skip.');
      }
      return;
    }

    // Progressive provisioning output
    heading(`Provisioning WordPress...`);

    const maxWait = 5 * 60 * 1000; // 5 minutes
    const pollInterval = 3000; // 3 seconds
    const provSpin = spinner('Setting up server environment...');
    provSpin.start();

    // Track which steps we've shown
    const shown = { php: false, ssl: false, wp: false };

    while (Date.now() - startTime < maxWait) {
      try {
        const detailRes = await client.get(`/sites/${site.id}/details`);
        const siteData = detailRes.data?.data;
        const siteInfo = siteData?.site || siteData;

        // The API returns status as 0 (active) or string. Also check for url + wp_version
        // as indicators that provisioning is complete.
        const status = siteInfo?.status;
        const isActive = status === 0 || status === 'Active' || status === 'active'
          || (siteInfo?.url && siteInfo?.wp_version);

        // Show progressive steps as data becomes available
        if (!shown.php && siteInfo?.php_version) {
          provSpin.stop();
          step(`PHP ${siteInfo.php_version} configured`);
          shown.php = true;
          provSpin.start();
          provSpin.text = 'Issuing SSL certificate...';
        }

        if (!shown.ssl && (siteInfo?.url || isActive)) {
          if (!shown.php) {
            provSpin.stop();
            step(`PHP ${siteInfo?.php_version || opts.php || '8.x'} configured`);
            shown.php = true;
          }
          provSpin.stop();
          step('SSL certificate issued');
          shown.ssl = true;
          provSpin.start();
          provSpin.text = 'Installing WordPress...';
        }

        if (isActive) {
          if (!shown.php) { provSpin.stop(); step(`PHP ${siteInfo?.php_version || opts.php || '8.x'} configured`); shown.php = true; provSpin.start(); }
          if (!shown.ssl) { provSpin.stop(); step('SSL certificate issued'); shown.ssl = true; provSpin.start(); }
          provSpin.stop();
          step('WordPress installed');

          const siteUrl = siteInfo?.url || siteData?.url || '';
          const domain = siteInfo?.main_domain || siteInfo?.sub_domain
            || siteInfo?.domain?.name || siteInfo?.domain
            || siteData?.domain?.name || siteData?.domain || '';
          const wpVersion = siteInfo?.wp_version || '';

          if (json) {
            // Details endpoint may have empty site_meta for recently provisioned sites;
            // fallback to list endpoint which reliably includes credentials.
            let meta = siteInfo?.site_meta || siteData?.site_meta || {};
            if (!meta.wp_username) {
              // Brief delay for credentials to propagate, then try list endpoint
              await new Promise(resolve => setTimeout(resolve, 2000));
              try {
                const listRes = await client.get('/sites', { params: { per_page: 50 } });
                const match = (listRes.data?.data || []).find((s: any) => s.id === site.id);
                if (match?.site_meta?.wp_username) meta = match.site_meta;
              } catch { /* ignore */ }
            }
            console.log(JSON.stringify({
              success: true,
              data: {
                id: site.id,
                url: siteUrl,
                domain,
                wp_version: wpVersion,
                php_version: siteInfo?.php_version || '',
                wp_username: meta.wp_username || '',
                wp_password: meta.wp_password || '',
                wp_admin_url: siteUrl ? `${siteUrl}/wp-admin` : '',
                status: 'Active',
                elapsed: elapsed() + 's',
              },
            }));
          } else {
            const displayUrl = siteUrl || (domain ? `https://${domain}` : '');
            console.log(`\n${chalk.bold.green('Ready')} in ${elapsed()}s ${chalk.dim('\u2192')} ${chalk.cyan.underline(displayUrl)}`);
          }
          return;
        }
      } catch {
        // Ignore polling errors, keep trying
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    provSpin.fail('Timed out waiting for site');
    info(`Site ID ${site.id} was created but may still be provisioning.`);
    info(`Check status with: instawp sites list`);
  } catch (err: any) {
    error('Could not create site', err.response?.data?.message || err.message);
    process.exit(1);
  }
}

// Register top-level `create` alias
export function registerCreateAlias(program: Command): void {
  program
    .command('create')
    .description('Create a new WordPress site (alias for sites create)')
    .requiredOption('--name <name>', 'Site name')
    .option('--php <version>', 'PHP version (e.g., 8.2)')
    .option('--config <id>', 'Configuration ID')
    .option('--no-wait', 'Do not wait for site to become active')
    .action(createSiteAction);
}
