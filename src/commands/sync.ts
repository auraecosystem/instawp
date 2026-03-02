import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { requireAuth, getClient } from '../lib/api.js';
import { success, error, spinner, info } from '../lib/output.js';
import type { SftpCredentials } from '../types.js';

function checkSshpass(): boolean {
  try {
    execSync('which sshpass', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getSshpassInstallInstructions(): string {
  const platform = process.platform;
  if (platform === 'darwin') {
    return 'Install sshpass: brew install hudochenkov/sshpass/sshpass';
  } else if (platform === 'linux') {
    return 'Install sshpass: sudo apt install sshpass  (or equivalent for your distro)';
  }
  return 'Install sshpass for your platform: https://github.com/kevinburke/sshpass';
}

async function enableSftp(siteId: string): Promise<void> {
  const client = getClient();
  await client.post(`/sites/${siteId}/update-sftp-status`, { status: 1 });
}

async function getSftpCredentials(siteId: string): Promise<SftpCredentials> {
  const client = getClient();
  const res = await client.get(`/sites/${siteId}/sftp-details`);
  const data = res.data?.data;
  return {
    host: data.host || data.ip,
    username: data.username,
    password: data.password,
    port: data.port || 22,
  };
}

export function registerSyncCommand(program: Command): void {
  const sync = program
    .command('sync')
    .description('Sync files with a remote site');

  sync
    .command('push')
    .description('Push local wp-content/ to remote site')
    .requiredOption('--site <id>', 'Site ID')
    .option('--path <path>', 'Local wp-content path', './wp-content/')
    .option('--remote-path <path>', 'Remote document root path')
    .option('--dry-run', 'Show what would be transferred')
    .action(async (opts) => {
      requireAuth();

      if (!checkSshpass()) {
        error('sshpass is required for sync.');
        info(getSshpassInstallInstructions());
        process.exit(1);
      }

      const spin = spinner('Enabling SFTP access...');
      spin.start();

      try {
        await enableSftp(opts.site);
        spin.succeed('SFTP enabled');

        const spin2 = spinner('Getting SFTP credentials...');
        spin2.start();
        const creds = await getSftpCredentials(opts.site);
        spin2.succeed('Got SFTP credentials');

        const remotePath = opts.remotePath || `/bitnami/wordpress/wp-content/`;
        const localPath = opts.path.endsWith('/') ? opts.path : opts.path + '/';

        const rsyncArgs = [
          '-avz',
          '--exclude=.git',
          '--exclude=node_modules',
          '--exclude=.DS_Store',
          opts.dryRun ? '--dry-run' : '',
          '-e', `"ssh -p ${creds.port} -o StrictHostKeyChecking=no"`,
          localPath,
          `${creds.username}@${creds.host}:${remotePath}`,
        ].filter(Boolean).join(' ');

        const cmd = `sshpass -p '${creds.password}' rsync ${rsyncArgs}`;

        info(`Syncing ${localPath} -> ${creds.host}:${remotePath}`);
        const spin3 = spinner('Pushing files...');
        spin3.start();

        try {
          const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          spin3.succeed('Push complete');
          if (output.trim()) {
            console.log(output);
          }
          success('Files pushed successfully');
        } catch (err: any) {
          spin3.fail('Push failed');
          error('rsync failed', err.stderr || err.message);
          process.exit(1);
        }
      } catch (err: any) {
        spin.fail('Sync setup failed');
        error('Could not set up sync', err.response?.data?.message || err.message);
        process.exit(1);
      }
    });

  sync
    .command('pull')
    .description('Pull remote wp-content/ to local')
    .requiredOption('--site <id>', 'Site ID')
    .option('--path <path>', 'Local destination path', './wp-content/')
    .option('--remote-path <path>', 'Remote document root path')
    .option('--dry-run', 'Show what would be transferred')
    .action(async (opts) => {
      requireAuth();

      if (!checkSshpass()) {
        error('sshpass is required for sync.');
        info(getSshpassInstallInstructions());
        process.exit(1);
      }

      const spin = spinner('Enabling SFTP access...');
      spin.start();

      try {
        await enableSftp(opts.site);
        spin.succeed('SFTP enabled');

        const spin2 = spinner('Getting SFTP credentials...');
        spin2.start();
        const creds = await getSftpCredentials(opts.site);
        spin2.succeed('Got SFTP credentials');

        const remotePath = opts.remotePath || `/bitnami/wordpress/wp-content/`;
        const localPath = opts.path.endsWith('/') ? opts.path : opts.path + '/';

        const rsyncArgs = [
          '-avz',
          '--exclude=.git',
          '--exclude=node_modules',
          '--exclude=.DS_Store',
          opts.dryRun ? '--dry-run' : '',
          '-e', `"ssh -p ${creds.port} -o StrictHostKeyChecking=no"`,
          `${creds.username}@${creds.host}:${remotePath}`,
          localPath,
        ].filter(Boolean).join(' ');

        const cmd = `sshpass -p '${creds.password}' rsync ${rsyncArgs}`;

        info(`Syncing ${creds.host}:${remotePath} -> ${localPath}`);
        const spin3 = spinner('Pulling files...');
        spin3.start();

        try {
          const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          spin3.succeed('Pull complete');
          if (output.trim()) {
            console.log(output);
          }
          success('Files pulled successfully');
        } catch (err: any) {
          spin3.fail('Pull failed');
          error('rsync failed', err.stderr || err.message);
          process.exit(1);
        }
      } catch (err: any) {
        spin.fail('Sync setup failed');
        error('Could not set up sync', err.response?.data?.message || err.message);
        process.exit(1);
      }
    });
}
