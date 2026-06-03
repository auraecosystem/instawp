import { Command } from 'commander';
import { join, dirname, basename } from 'node:path';
import { existsSync, mkdirSync, statSync, createReadStream, createWriteStream, unlinkSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import chalk from 'chalk';
import { requireAuth } from '../lib/api.js';
import { resolveSite } from '../lib/site-resolver.js';
import { ensureSshAccess } from '../lib/ssh-keys.js';
import { execViaSsh, execViaSshToFile, scpUpload } from '../lib/ssh-connection.js';
import { success, error, spinner, info, isJsonMode } from '../lib/output.js';

/** Timestamp like `2026-05-23T12-34-56` (filename-safe — `:` is illegal on Windows). */
function isoTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, '');
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function gunzipFile(src: string, dest: string): Promise<void> {
  await pipeline(createReadStream(src), createGunzip(), createWriteStream(dest));
}

async function promptYesNo(question: string): Promise<boolean> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(question, resolve);
  });
  rl.close();
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
}

export function registerDbCommand(program: Command): void {
  const db = program
    .command('db')
    .description('Push/pull MySQL database dumps to/from a remote site');

  // db pull <site>
  db
    .command('pull <site>')
    .description('Pull remote MySQL database to a local SQL dump')
    .option('--output <path>', 'Output file path (default: ./db-<site>-<timestamp>.sql.gz)')
    .option('--no-compress', 'Write uncompressed .sql instead of .sql.gz')
    .action(async (siteIdentifier: string, opts: any) => {
      requireAuth();

      const resolveSpin = spinner('Resolving site...');
      resolveSpin.start();
      let site;
      try {
        site = await resolveSite(siteIdentifier);
        resolveSpin.succeed(`Site: ${site.name || site.sub_domain} (ID: ${site.id})`);
      } catch {
        resolveSpin.fail('Site resolution failed');
        process.exit(1);
      }

      const conn = await ensureSshAccess(site.id);
      const wpPath = `/home/${conn.username}/web/${conn.domain}/public_html`;

      const compress = opts.compress !== false;
      const siteLabel = sanitizeForFilename(site.name || site.sub_domain || `site-${site.id}`);
      const ext = compress ? 'sql.gz' : 'sql';
      const outputPath = opts.output || `./db-${siteLabel}-${isoTimestamp()}.${ext}`;

      // Make sure the output directory exists
      const outDir = dirname(outputPath);
      if (outDir && outDir !== '.' && !existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }

      const dumpSpin = spinner(`Exporting database from ${conn.domain}...`);
      dumpSpin.start();

      // Stream `wp db export -` from remote. If --compress, pipe through gzip on
      // the remote side so we never materialize the uncompressed dump locally.
      const remoteCmd = compress
        ? `cd ${wpPath} && wp db export --single-transaction - | gzip`
        : `cd ${wpPath} && wp db export --single-transaction -`;

      try {
        const { exitCode, stderr } = execViaSshToFile(conn, remoteCmd, outputPath);
        if (exitCode !== 0) {
          dumpSpin.fail('Database export failed');
          if (stderr) error(stderr.trim());
          // Clean up empty/partial file
          try { if (existsSync(outputPath)) unlinkSync(outputPath); } catch { /* ignore */ }
          process.exit(1);
        }
        const sizeBytes = statSync(outputPath).size;
        if (sizeBytes === 0) {
          dumpSpin.fail('Database export produced an empty file');
          try { unlinkSync(outputPath); } catch { /* ignore */ }
          process.exit(1);
        }
        dumpSpin.succeed(`Database exported (${formatBytes(sizeBytes)})`);

        success('Pull complete', {
          file: outputPath,
          size_bytes: sizeBytes,
          site_id: site.id,
        });
      } catch (err: any) {
        dumpSpin.fail('Database export failed');
        error(err.message || String(err));
        try { if (existsSync(outputPath)) unlinkSync(outputPath); } catch { /* ignore */ }
        process.exit(1);
      }
    });

  // db push <site> <file>
  db
    .command('push <site> <file>')
    .description('Push local SQL dump to remote site database (creates a backup first)')
    .option('--force', 'Skip confirmation prompt')
    .option('--no-backup', 'Skip taking a remote backup before overwrite (DANGEROUS)')
    .addHelpText('after', `
Notes:
  - Always takes a remote backup first unless --no-backup is passed.
  - After pushing to a site on a different domain, you may want to run:
      instawp wp <site> search-replace <old-url> <new-url>
    Auto-replacing site URLs is out of scope for this command.
`)
    .action(async (siteIdentifier: string, file: string, opts: any) => {
      requireAuth();

      // Validate input file
      if (!existsSync(file)) {
        error(`File not found: ${file}`);
        process.exit(1);
      }
      const localSize = statSync(file).size;
      if (localSize === 0) {
        error(`File is empty: ${file}`);
        process.exit(1);
      }

      // In JSON mode, can't prompt — require --force
      if (isJsonMode() && !opts.force) {
        error('--force is required when using --json (cannot prompt for confirmation)');
        process.exit(1);
      }

      const resolveSpin = spinner('Resolving site...');
      resolveSpin.start();
      let site;
      try {
        site = await resolveSite(siteIdentifier);
        resolveSpin.succeed(`Site: ${site.name || site.sub_domain} (ID: ${site.id})`);
      } catch {
        resolveSpin.fail('Site resolution failed');
        process.exit(1);
      }

      const conn = await ensureSshAccess(site.id);
      const wpPath = `/home/${conn.username}/web/${conn.domain}/public_html`;
      const remoteHome = `/home/${conn.username}`;

      const timestamp = isoTimestamp();
      const backupFilename = `db-backup-${timestamp}.sql.gz`;
      const backupRemotePath = `${remoteHome}/${backupFilename}`;
      const takeBackup = opts.backup !== false;

      // Confirmation
      if (!opts.force) {
        const backupLine = takeBackup
          ? `A backup will be saved to ~/${backupFilename} on the remote.`
          : chalk.red('NO BACKUP will be taken (--no-backup). This is irreversible.');
        console.log(`\nThis will ${chalk.bold.red('OVERWRITE')} the database on ${chalk.bold(conn.domain)}.`);
        console.log(backupLine);
        const ok = await promptYesNo('Continue? (y/N) ');
        if (!ok) {
          info('Cancelled.');
          return;
        }
      }

      // Step 1: Backup
      if (takeBackup) {
        const backupSpin = spinner(`Backing up remote database to ~/${backupFilename}...`);
        backupSpin.start();
        const backupCmd = `cd ${wpPath} && wp db export --single-transaction - | gzip > ${backupRemotePath}`;
        const backupResult = execViaSsh(conn, backupCmd);
        if (backupResult.exitCode !== 0) {
          backupSpin.fail('Backup failed — aborting push');
          if (backupResult.stderr) error(backupResult.stderr.trim());
          process.exit(1);
        }
        backupSpin.succeed(`Backup saved: ~/${backupFilename}`);
      } else {
        info('Skipping backup (--no-backup)');
      }

      // Step 2: Prepare local SQL (gunzip if needed)
      const isGzipped = file.endsWith('.gz') || file.endsWith('.gzip');
      let uploadSource = file;
      let tempLocalDecompressed: string | null = null;

      if (isGzipped) {
        const decompressSpin = spinner('Decompressing local dump...');
        decompressSpin.start();
        try {
          const tmpName = `instawp-db-push-${randomBytes(6).toString('hex')}.sql`;
          tempLocalDecompressed = join(process.env.TMPDIR || '/tmp', tmpName);
          await gunzipFile(file, tempLocalDecompressed);
          uploadSource = tempLocalDecompressed;
          const decompressedSize = statSync(uploadSource).size;
          decompressSpin.succeed(`Decompressed (${formatBytes(decompressedSize)})`);
        } catch (err: any) {
          decompressSpin.fail('Decompression failed');
          error(err.message || String(err));
          if (tempLocalDecompressed) {
            try { unlinkSync(tempLocalDecompressed); } catch { /* ignore */ }
          }
          if (takeBackup) {
            info(`Remote backup preserved: ~/${backupFilename}`);
          }
          process.exit(1);
        }
      }

      // Step 3: Upload via scp to /tmp on remote
      const remoteTempName = `db-import-${randomBytes(6).toString('hex')}.sql`;
      const remoteTempPath = `/tmp/${remoteTempName}`;

      const uploadSpin = spinner(`Uploading ${basename(uploadSource)} to remote...`);
      uploadSpin.start();
      const scpExit = scpUpload(conn, uploadSource, remoteTempPath);
      if (scpExit !== 0) {
        uploadSpin.fail(`Upload failed (scp exit ${scpExit})`);
        if (tempLocalDecompressed) {
          try { unlinkSync(tempLocalDecompressed); } catch { /* ignore */ }
        }
        if (takeBackup) {
          info(`Remote backup preserved: ~/${backupFilename}`);
        }
        process.exit(1);
      }
      uploadSpin.succeed('Upload complete');

      // Clean up local temp file (we have it on remote now)
      if (tempLocalDecompressed) {
        try { unlinkSync(tempLocalDecompressed); } catch { /* ignore */ }
      }

      // Step 4: Import on remote
      const importSpin = spinner(`Importing database on ${conn.domain}...`);
      importSpin.start();
      const importResult = execViaSsh(
        conn,
        `cd ${wpPath} && wp db import ${remoteTempPath}`,
      );

      if (importResult.exitCode !== 0) {
        importSpin.fail('Import failed');
        if (importResult.stderr) error(importResult.stderr.trim());
        else if (importResult.stdout) error(importResult.stdout.trim());

        // Clean up temp file on remote even on failure (best effort)
        execViaSsh(conn, `rm -f ${remoteTempPath}`);

        if (takeBackup) {
          console.log('');
          info(`Remote backup preserved at: ~/${backupFilename}`);
          info('To restore:');
          console.log(`  ssh ${conn.username}@${conn.host} 'cd ${wpPath} && gunzip -c ${backupRemotePath} | wp db import -'`);
          console.log(`  ${chalk.dim('# or pull the backup down and re-push:')}`);
          console.log(`  scp ${conn.username}@${conn.host}:${backupRemotePath} ./`);
          console.log(`  instawp db push ${siteIdentifier} ./${backupFilename}`);
        } else {
          error('No backup was taken — database state may be inconsistent.');
        }
        process.exit(1);
      }
      importSpin.succeed('Database imported');

      // Step 5: Cleanup remote temp file
      const cleanupSpin = spinner('Cleaning up...');
      cleanupSpin.start();
      const cleanupResult = execViaSsh(conn, `rm -f ${remoteTempPath}`);
      if (cleanupResult.exitCode !== 0) {
        cleanupSpin.fail(`Could not remove ${remoteTempPath} (non-fatal)`);
      } else {
        cleanupSpin.succeed('Cleanup complete');
      }

      success('Push complete', {
        site_id: site.id,
        backup_path: takeBackup ? backupRemotePath : null,
        restored_from: file,
        size_bytes: localSize,
      });

      if (!isJsonMode() && takeBackup) {
        console.log(`\n  ${chalk.dim('Backup:')} ~/${backupFilename} ${chalk.dim('(on remote)')}`);
      }
    });
}
