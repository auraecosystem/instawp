import { Command } from 'commander';
import chalk from 'chalk';
import { requireAuth, getClient } from '../lib/api.js';
import { resolveSite } from '../lib/site-resolver.js';
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
    .option('--per-page <count>', 'Results per page', '50')
    .option('--all', 'Fetch all pages')
    .action(async (opts) => {
      requireAuth();
      const spin = spinner('Fetching sites...');
      spin.start();

      try {
        const client = getClient();
        let allSites: any[] = [];
        let page = parseInt(opts.page);
        const perPage = parseInt(opts.perPage);
        let lastPage = 1;
        let total = 0;

        // Fetch first page
        const params: Record<string, any> = { page, per_page: perPage };
        if (opts.status) params.status = opts.status;

        const res = await client.get('/sites', { params });
        allSites = res.data?.data || [];
        const meta = res.data?.meta || {};
        lastPage = meta.last_page || 1;
        total = meta.total || allSites.length;

        // If --all, fetch remaining pages
        if (opts.all && lastPage > page) {
          for (let p = page + 1; p <= lastPage; p++) {
            const r = await client.get('/sites', { params: { ...params, page: p } });
            allSites = allSites.concat(r.data?.data || []);
          }
        }

        spin.stop();

        if (allSites.length === 0) {
          if (isJsonMode()) {
            console.log(JSON.stringify([]));
          } else {
            info('No sites found.');
          }
          return;
        }

        const rows = allSites.map((s: any) => ({
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

        // Show pagination hint if there are more pages and not fetching all
        if (!opts.all && !isJsonMode() && lastPage > page) {
          info(`Showing ${allSites.length} of ${total} sites (page ${page}/${lastPage}). Use --all to fetch all.`);
        }
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
    .command('delete <site>')
    .description('Delete a site (by ID, name, or domain)')
    .option('--force', 'Skip confirmation')
    .action(async (siteIdentifier, opts) => {
      requireAuth();

      const spin = spinner('Resolving site...');
      spin.start();

      let site;
      try {
        site = await resolveSite(siteIdentifier);
        spin.stop();
      } catch {
        spin.fail('Site resolution failed');
        process.exit(1);
      }

      const label = site.name || site.sub_domain || String(site.id);

      if (!opts.force) {
        if (isJsonMode()) {
          error('Use --force flag to delete in JSON mode');
          process.exit(1);
        }

        // Interactive confirmation
        const readline = await import('node:readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Are you sure you want to delete site "${label}" (ID: ${site.id})? (y/N) `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          info('Cancelled.');
          return;
        }
      }

      const spin2 = spinner(`Deleting site ${label}...`);
      spin2.start();

      try {
        const client = getClient();
        await client.delete(`/sites/${site.id}`);
        spin2.stop();
        success(`Site "${label}" (ID: ${site.id}) has been deleted`);
      } catch (err: any) {
        spin2.fail('Failed to delete site');
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
    const taskId = site.task_id;
    // Fetch site details once for php_version (available immediately at creation)
    let phpVersion = opts.php || '8.x';
    try {
      const initDetail = await client.get(`/sites/${site.id}/details`);
      phpVersion = initDetail.data?.data?.php_version || phpVersion;
    } catch { /* use fallback */ }
    const provSpin = spinner('Setting up server environment...');
    provSpin.start();

    // Track which steps we've shown based on task percentage:
    //   ~38% = server environment ready (PHP configured)
    //   ~66% = domain/SSL setup done
    //   ~79% = WordPress being installed
    //   100% = completed
    const shown = { php: false, ssl: false, wp: false };

    // Helper to update spinner with percentage
    const spinText = (label: string, pct: number) =>
      pct > 0 ? `${label} ${chalk.dim(`(${Math.round(pct)}%)`)}` : label;

    while (Date.now() - startTime < maxWait) {
      try {
        // Poll task status for real provisioning progress
        let pct = 0;
        let taskDone = false;
        if (taskId) {
          try {
            const taskRes = await client.get(`/tasks/${taskId}/status`);
            const task = taskRes.data?.data;
            pct = parseFloat(task?.percentage_complete) || 0;
            taskDone = task?.status === 'completed';
            if (task?.status === 'error') {
              provSpin.fail('Provisioning failed');
              error('Site provisioning failed', task?.comment || 'Unknown error');
              process.exit(1);
            }
          } catch { /* task endpoint may not be available, fall through */ }
        }

        // Update spinner with current percentage
        if (!shown.php) {
          provSpin.text = spinText('Setting up server environment...', pct);
        } else if (!shown.ssl) {
          provSpin.text = spinText('Issuing SSL certificate...', pct);
        } else if (!shown.wp) {
          provSpin.text = spinText('Installing WordPress...', pct);
        }

        // Show progressive steps based on actual task percentage
        if (!shown.php && pct >= 38) {
          provSpin.text = 'Setting up server environment...';
          provSpin.stop();
          step(`PHP ${phpVersion} configured`);
          shown.php = true;
          provSpin.start();
        }

        if (!shown.ssl && pct >= 66) {
          if (!shown.php) {
            provSpin.text = 'Setting up server environment...';
            provSpin.stop();
            step(`PHP ${phpVersion} configured`);
            shown.php = true;
          }
          provSpin.text = 'Issuing SSL certificate...';
          provSpin.stop();
          step('SSL certificate issued');
          shown.ssl = true;
          provSpin.start();
        }

        if (taskDone || pct >= 100) {
          if (!shown.php) { provSpin.stop(); step(`PHP ${phpVersion} configured`); shown.php = true; provSpin.start(); }
          if (!shown.ssl) { provSpin.stop(); step('SSL certificate issued'); shown.ssl = true; provSpin.start(); }
          provSpin.stop();
          step('WordPress installed');

          // Fetch final site details for the output
          const detailRes = await client.get(`/sites/${site.id}/details`);
          const siteData = detailRes.data?.data;
          const siteInfo = siteData?.site || siteData;
          const meta = siteInfo?.site_meta || siteData?.site_meta || {};

          const siteUrl = siteInfo?.url || site.wp_url || '';
          const domain = siteInfo?.main_domain || siteInfo?.sub_domain
            || siteInfo?.domain?.name || siteInfo?.domain
            || siteData?.domain?.name || siteData?.domain || '';
          const wpVersion = siteInfo?.wp_version || '';

          if (json) {
            // If credentials not yet in details, try list endpoint
            let creds = meta;
            if (!creds.wp_username) {
              try {
                const listRes = await client.get('/sites', { params: { per_page: 50 } });
                const match = (listRes.data?.data || []).find((s: any) => s.id === site.id);
                if (match?.site_meta?.wp_username) creds = match.site_meta;
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
                wp_username: creds.wp_username || '',
                wp_password: creds.wp_password || '',
                wp_admin_url: siteUrl ? `${siteUrl}/wp-admin` : '',
                magic_login_url: creds.wp_magic_login_url || (siteUrl ? `${siteUrl}/wp-login.php?instawp-magic-login=1` : ''),
                status: 'Active',
                elapsed: elapsed() + 's',
              },
            }));
          } else {
            // Fetch credentials for human output too
            let creds = meta;
            if (!creds.wp_username) {
              try {
                const listRes = await client.get('/sites', { params: { per_page: 50 } });
                const match = (listRes.data?.data || []).find((s: any) => s.id === site.id);
                if (match?.site_meta?.wp_username) creds = match.site_meta;
              } catch { /* ignore */ }
            }

            const displayUrl = siteUrl || (domain ? `https://${domain}` : '');
            console.log(`\n${chalk.bold.green('Ready')} in ${elapsed()}s ${chalk.dim('\u2192')} ${chalk.cyan.underline(displayUrl)}`);

            if (creds.wp_username) {
              console.log(`\n  ${chalk.dim('Username:')} ${creds.wp_username}`);
              console.log(`  ${chalk.dim('Password:')} ${creds.wp_password}`);
            }
            const adminUrl = displayUrl ? `${displayUrl}/wp-admin` : '';
            if (adminUrl) {
              console.log(`  ${chalk.dim('WP Admin:')} ${chalk.cyan.underline(adminUrl)}`);
            }
            const magicUrl = creds.wp_magic_login_url || (siteUrl ? `${siteUrl}/wp-login.php?instawp-magic-login=1` : '');
            if (magicUrl) {
              console.log(`  ${chalk.dim('Magic Login:')} ${chalk.cyan.underline(magicUrl)}`);
            }
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
