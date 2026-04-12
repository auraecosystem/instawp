import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { requireAuth } from '../lib/api.js';
import { resolveSite } from '../lib/site-resolver.js';
import { ensureSshAccess } from '../lib/ssh-keys.js';
import { rsyncViaSsh } from '../lib/ssh-connection.js';
import { success, error, spinner, info } from '../lib/output.js';

function checkRsync(): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, ['rsync'], { stdio: 'ignore' });
  return result.status === 0;
}

function getRsyncInstallInstructions(): string {
  const platform = process.platform;
  if (platform === 'darwin') return 'Install rsync: brew install rsync';
  if (platform === 'linux') return 'Install rsync: sudo apt install rsync  (or equivalent for your distro)';
  return 'Install rsync for your platform.';
}

function buildRemotePath(conn: { username: string; domain: string }): string {
  return `/home/${conn.username}/web/${conn.domain}/public_html/wp-content/`;
}

export function registerSyncCommand(program: Command): void {
  const sync = program
    .command('sync')
    .description('Sync wp-content files with a remote site via rsync');

  sync
    .command('push <site>')
    .description('Push local wp-content/ to remote site')
    .option('--path <path>', 'Local wp-content path', './wp-content/')
    .option('--exclude <pattern...>', 'Additional exclude patterns')
    .option('--include <pattern...>', 'Include patterns')
    .option('--dry-run', 'Show what would be transferred')
    .action(async (siteIdentifier: string, opts) => {
      requireAuth();

      if (!checkRsync()) {
        error('rsync is required for sync.');
        info(getRsyncInstallInstructions());
        process.exit(1);
      }

      const spin = spinner('Resolving site...');
      spin.start();

      let site;
      try {
        site = await resolveSite(siteIdentifier);
        spin.succeed(`Site: ${site.name || site.sub_domain} (ID: ${site.id})`);
      } catch {
        spin.fail('Site resolution failed');
        process.exit(1);
      }

      const conn = await ensureSshAccess(site.id);

      const localPath = opts.path.endsWith('/') ? opts.path : opts.path + '/';
      const remotePath = buildRemotePath(conn);
      const remoteTarget = `${conn.username}@${conn.host}:${remotePath}`;

      const extraArgs: string[] = [];
      if (opts.exclude) {
        for (const pattern of opts.exclude) {
          extraArgs.push(`--exclude=${pattern}`);
        }
      }
      if (opts.include) {
        for (const pattern of opts.include) {
          extraArgs.push(`--include=${pattern}`);
        }
      }

      info(`Pushing ${localPath} -> ${conn.host}:${remotePath}`);
      if (opts.dryRun) info('(dry run)');

      const exitCode = rsyncViaSsh(conn, localPath, remoteTarget, extraArgs, !!opts.dryRun, true);

      if (exitCode === 0) {
        success('Push complete');
      } else {
        error(`rsync exited with code ${exitCode}`);
        process.exit(exitCode);
      }
    });

  sync
    .command('pull <site>')
    .description('Pull remote wp-content/ to local')
    .option('--path <path>', 'Local destination path', './wp-content/')
    .option('--exclude <pattern...>', 'Additional exclude patterns')
    .option('--include <pattern...>', 'Include patterns')
    .option('--dry-run', 'Show what would be transferred')
    .action(async (siteIdentifier: string, opts) => {
      requireAuth();

      if (!checkRsync()) {
        error('rsync is required for sync.');
        info(getRsyncInstallInstructions());
        process.exit(1);
      }

      const spin = spinner('Resolving site...');
      spin.start();

      let site;
      try {
        site = await resolveSite(siteIdentifier);
        spin.succeed(`Site: ${site.name || site.sub_domain} (ID: ${site.id})`);
      } catch {
        spin.fail('Site resolution failed');
        process.exit(1);
      }

      const conn = await ensureSshAccess(site.id);

      const localPath = opts.path.endsWith('/') ? opts.path : opts.path + '/';
      const remotePath = buildRemotePath(conn);
      const remoteSource = `${conn.username}@${conn.host}:${remotePath}`;

      const extraArgs: string[] = [];
      if (opts.exclude) {
        for (const pattern of opts.exclude) {
          extraArgs.push(`--exclude=${pattern}`);
        }
      }
      if (opts.include) {
        for (const pattern of opts.include) {
          extraArgs.push(`--include=${pattern}`);
        }
      }

      info(`Pulling ${conn.host}:${remotePath} -> ${localPath}`);
      if (opts.dryRun) info('(dry run)');

      const exitCode = rsyncViaSsh(conn, remoteSource, localPath, extraArgs, !!opts.dryRun, true);

      if (exitCode === 0) {
        success('Pull complete');
      } else {
        error(`rsync exited with code ${exitCode}`);
        process.exit(exitCode);
      }
    });
}
