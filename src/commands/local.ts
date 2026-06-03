import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import open from 'open';
import Database from 'better-sqlite3';
import { resolveFromModule } from '../lib/paths.js';
import { bundledBusybox } from '../lib/windows-binaries.js';
import {
  getLocalInstances,
  getLocalInstance,
  setLocalInstance,
  removeLocalInstance,
} from '../lib/config.js';
import {
  getInstanceDir,
  getNextPort,
  createInstanceDir,
  deleteInstanceDir,
  startServer,
  startServerBackground,
  stopServer as stopServerProcess,
  isServerRunning,
  checkPlaygroundConnectivity,
  ensureAutoLogin,
} from '../lib/local-env.js';
import { requireAuth, getClient } from '../lib/api.js';
import { resolveSite } from '../lib/site-resolver.js';
import { ensureSshAccess } from '../lib/ssh-keys.js';
import { syncFiles, execViaSsh, execViaSshToFile } from '../lib/ssh-connection.js';
import { listLocalFiles } from '../lib/sftp-sync.js';
import { success, error, table, spinner, info, isJsonMode } from '../lib/output.js';
import type { LocalInstance } from '../types.js';

export function registerLocalCommand(program: Command): void {
  const local = program
    .command('local')
    .description('Manage local WordPress sites (powered by WordPress Playground)');

  // local create
  local
    .command('create')
    .description('Create and start a local WordPress site')
    .option('--name <name>', 'Instance name (auto-generated if omitted)')
    .option('--wp <version>', 'WordPress version', 'latest')
    .option('--php <version>', 'PHP version (7.4-8.5)', '8.3')
    .option('--port <port>', 'Server port')
    .option('--blueprint <path>', 'Blueprint JSON file for setup')
    .option('--no-open', 'Do not open browser')
    .option('--background', 'Run server in background and return immediately')
    .action(async (opts) => {
      const instances = getLocalInstances();
      const name = sanitizeName(opts.name || nextAutoName(instances));

      if (instances[name]) {
        error(`Instance "${name}" already exists. Use 'instawp local start ${name}' or choose a different name.`);
        process.exit(1);
      }

      const spin = spinner(`Creating local WordPress site "${name}"...`);
      spin.start();

      try {
        // Pre-check connectivity
        const connErr = await checkPlaygroundConnectivity();
        if (connErr) {
          spin.fail('Network check failed');
          error(connErr);
          process.exit(1);
        }

        const port = opts.port ? parseInt(opts.port) : await getNextPort(instances);
        const dir = createInstanceDir(name);
        spin.stop();

        const instance: LocalInstance = {
          name,
          port,
          php: opts.php,
          wp: opts.wp,
          path: dir,
          createdAt: new Date().toISOString(),
        };

        setLocalInstance(instance);

        if (!isJsonMode()) {
          success(`Instance "${name}" created`);
          console.log(`\n${chalk.dim('#')} Starting WordPress ${opts.wp} with PHP ${opts.php}...`);
          console.log(`${chalk.dim('#')} Data stored at: ${chalk.dim(dir)}\n`);
        }

        await launchServer(instance, opts);
      } catch (err: any) {
        spin.stop();
        // Clean up on failure
        deleteInstanceDir(name);
        removeLocalInstance(name);
        error('Failed to create local site', err.message);
        process.exit(1);
      }
    });

  // local start <name>
  local
    .command('start [name]')
    .description('Start a local WordPress site')
    .option('--blueprint <path>', 'Blueprint JSON file')
    .option('--no-open', 'Do not open browser')
    .option('--background', 'Run server in background and return immediately')
    .action(async (name: string | undefined, opts: any) => {
      const instanceName = name || 'my-site';
      const instance = getLocalInstance(instanceName);

      if (!instance) {
        error(`Instance "${instanceName}" not found. Run 'instawp local create --name ${instanceName}' first.`);
        const instances = getLocalInstances();
        const names = Object.keys(instances);
        if (names.length > 0) {
          info(`Available instances: ${names.join(', ')}`);
        }
        process.exit(1);
      }

      ensureAutoLogin(instance);
      await launchServer(instance, opts);
    });

  // local stop [name]
  local
    .command('stop [name]')
    .description('Stop a background local site')
    .action((name: string | undefined) => {
      const instanceName = name || 'my-site';
      const instance = getLocalInstance(instanceName);

      if (!instance) {
        error(`Instance "${instanceName}" not found.`);
        process.exit(1);
      }

      if (stopServerProcess(instance)) {
        success(`Stopped "${instanceName}"`);
      } else {
        info(`"${instanceName}" is not running in background.`);
      }
    });

  // local list
  local
    .command('list')
    .description('List local WordPress sites')
    .action(() => {
      const instances = getLocalInstances();
      const entries = Object.values(instances);

      if (entries.length === 0) {
        if (isJsonMode()) {
          console.log(JSON.stringify([]));
        } else {
          info('No local sites. Create one with: instawp local create');
        }
        return;
      }

      if (isJsonMode()) {
        console.log(JSON.stringify(entries));
        return;
      }

      const rows = entries.map((i: LocalInstance) => ({
        name: i.name,
        status: isServerRunning(i) ? 'running' : 'stopped',
        url: `http://127.0.0.1:${i.port}`,
        wp: i.wp,
        php: i.php,
        path: i.path,
      }));

      table(['Name', 'Status', 'URL', 'WP', 'PHP', 'Path'], rows);
    });

  // local delete <name>
  local
    .command('delete <name>')
    .description('Delete a local WordPress site and its data')
    .option('--force', 'Skip confirmation')
    .action(async (name: string, opts: any) => {
      const instance = getLocalInstance(name);

      if (!instance) {
        error(`Instance "${name}" not found.`);
        process.exit(1);
      }

      if (!opts.force && !isJsonMode()) {
        const readline = await import('node:readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Delete local site "${name}" and all its data? (y/N) `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          info('Cancelled.');
          return;
        }
      }

      deleteInstanceDir(name);
      removeLocalInstance(name);

      if (isJsonMode()) {
        console.log(JSON.stringify({ deleted: name }));
      } else {
        success(`Instance "${name}" deleted.`);
      }
    });
  // local push <local-name> [cloud-site]
  local
    .command('push <local-name> [cloud-site]')
    .description('Push local wp-content to an InstaWP cloud site')
    .option('--include <pattern...>', 'Include patterns (e.g. .git)')
    .option('--exclude <pattern...>', 'Additional exclude patterns')
    .option('--dry-run', 'Show what would be transferred')
    .action(async (localName: string, cloudSiteArg: string | undefined, opts: any) => {
      requireAuth();

      const instance = getLocalInstance(localName);
      if (!instance) {
        error(`Local instance "${localName}" not found.`);
        process.exit(1);
      }

      const localWpContent = join(instance.path, 'wp-content') + '/';

      // A dry run must be side-effect free. With no cloud site specified, a real
      // push would *create* one — which a dry run must never do — so preview the
      // local files that would be pushed (pure filesystem walk, no network) and
      // stop. Previously this provisioned a real site, then failed connecting to
      // its not-yet-resolvable hostname ("Address lookup failed for host").
      if (opts.dryRun && !cloudSiteArg) {
        const excludes = ['database', 'db.php', 'mu-plugins', '.git', 'node_modules', '.DS_Store', ...(opts.exclude ?? [])];
        const files = listLocalFiles(join(instance.path, 'wp-content'), excludes);
        if (isJsonMode()) {
          console.log(JSON.stringify({ success: true, dry_run: true, would_create_site: localName, files }));
        } else {
          info(`(dry run) Would create cloud site "${localName}" and push ${chalk.dim(localWpContent)}`);
          for (const rel of files) console.log(`  ${chalk.dim('↑')} ${rel}`);
          info(`(dry run) ${files.length} file(s) would be pushed. No cloud site was created.`);
        }
        return;
      }

      if (!checkRsync()) {
        error('rsync is required for sync on macOS/Linux. Install: brew install rsync (macOS) or your distro package.');
        process.exit(1);
      }

      // If no cloud site specified, create one
      let site;
      if (!cloudSiteArg) {
        const spin = spinner('Creating cloud site...');
        spin.start();
        try {
          const client = getClient();
          // Default to a reserved (permanent) site, consistent with `instawp create`.
          const res = await client.post('/sites', { site_name: localName, is_reserved: true });
          site = res.data?.data;
          if (!site?.id) throw new Error('Unexpected API response');
          spin.succeed(`Cloud site created (ID: ${site.id})`);

          // Wait for provisioning
          const provSpin = spinner('Waiting for site to provision...');
          provSpin.start();
          const taskId = site.task_id;
          const maxWait = 5 * 60 * 1000;
          const start = Date.now();
          while (Date.now() - start < maxWait) {
            if (taskId) {
              try {
                const taskRes = await client.get(`/tasks/${taskId}/status`);
                const task = taskRes.data?.data;
                if (task?.status === 'completed' || parseFloat(task?.percentage_complete) >= 100) {
                  provSpin.succeed('Site provisioned');
                  break;
                }
                if (task?.status === 'error') {
                  provSpin.fail('Provisioning failed');
                  error(task?.comment || 'Unknown error');
                  process.exit(1);
                }
                provSpin.text = `Provisioning... (${Math.round(parseFloat(task?.percentage_complete) || 0)}%)`;
              } catch { /* ignore poll errors */ }
            }
            await new Promise(r => setTimeout(r, 3000));
          }

          // Re-resolve to get full details
          site = await resolveSite(String(site.id));
        } catch (err: any) {
          spin.fail('Failed to create cloud site');
          error(err.response?.data?.message || err.message);
          process.exit(1);
        }
      } else {
        const spin = spinner('Resolving cloud site...');
        spin.start();
        try {
          site = await resolveSite(cloudSiteArg);
          spin.succeed(`Cloud site: ${site.name || site.sub_domain} (ID: ${site.id})`);
        } catch {
          spin.fail('Site resolution failed');
          process.exit(1);
        }
      }

      // Get SSH access
      const conn = await ensureSshAccess(site.id);
      const remotePath = `/home/${conn.username}/web/${conn.domain}/public_html/wp-content/`;

      const extraArgs: string[] = [
        '--exclude=database', // Don't push SQLite database to cloud (cloud uses MySQL)
        '--exclude=db.php',
        '--exclude=mu-plugins', // Playground mu-plugins are local-only
      ];
      if (opts.exclude) {
        for (const pattern of opts.exclude) {
          extraArgs.push(`--exclude=${pattern}`);
        }
      }

      const remoteTarget = `${conn.username}@${conn.host}:${remotePath}`;
      info(`Pushing ${chalk.dim(localWpContent)} -> ${chalk.dim(conn.host + ':' + remotePath)}`);
      if (opts.dryRun) info('(dry run)');

      const exitCode = await syncFiles(conn, localWpContent, remoteTarget, extraArgs, !!opts.dryRun, true);

      if (exitCode === 0) {
        success('Push complete!');
        if (site.url) {
          console.log(`\n  ${chalk.dim('Cloud site:')} ${chalk.cyan.underline(site.url)}`);
        }
      } else {
        error(`rsync exited with code ${exitCode}`);
        process.exit(exitCode);
      }
    });

  // local pull <local-name> <cloud-site>
  local
    .command('pull <local-name> <cloud-site>')
    .description('Pull wp-content from an InstaWP cloud site to local')
    .option('--include <pattern...>', 'Include patterns (e.g. .git)')
    .option('--exclude <pattern...>', 'Additional exclude patterns')
    .option('--dry-run', 'Show what would be transferred')
    .action(async (localName: string, cloudSiteArg: string, opts: any) => {
      requireAuth();

      const instance = getLocalInstance(localName);
      if (!instance) {
        error(`Local instance "${localName}" not found.`);
        process.exit(1);
      }

      if (!checkRsync()) {
        error('rsync is required for sync on macOS/Linux. Install: brew install rsync (macOS) or your distro package.');
        process.exit(1);
      }

      const localWpContent = join(instance.path, 'wp-content') + '/';

      const spin = spinner('Resolving cloud site...');
      spin.start();
      let site;
      try {
        site = await resolveSite(cloudSiteArg);
        spin.succeed(`Cloud site: ${site.name || site.sub_domain} (ID: ${site.id})`);
      } catch {
        spin.fail('Site resolution failed');
        process.exit(1);
      }

      const conn = await ensureSshAccess(site.id);
      const remotePath = `/home/${conn.username}/web/${conn.domain}/public_html/wp-content/`;

      const extraArgs: string[] = [];
      if (opts.include) {
        for (const pattern of opts.include) {
          extraArgs.push(`--include=${pattern}`);
        }
      }
      extraArgs.push(
        '--exclude=database', // Don't overwrite local SQLite database
        '--exclude=db.php',
        '--exclude=mu-plugins',
      );
      if (opts.exclude) {
        for (const pattern of opts.exclude) {
          extraArgs.push(`--exclude=${pattern}`);
        }
      }

      const remoteSource = `${conn.username}@${conn.host}:${remotePath}`;
      info(`Pulling ${chalk.dim(conn.host + ':' + remotePath)} -> ${chalk.dim(localWpContent)}`);
      if (opts.dryRun) info('(dry run)');

      const exitCode = await syncFiles(conn, remoteSource, localWpContent, extraArgs, !!opts.dryRun, true);

      if (exitCode === 0) {
        success('Pull complete! Restart the local site to see changes.');
      } else {
        error(`rsync exited with code ${exitCode}`);
        process.exit(exitCode);
      }
    });

  // local clone <cloud-site>
  local
    .command('clone <cloud-site>')
    .description('Clone a complete InstaWP cloud site to local')
    .option('--name <name>', 'Local instance name (defaults to cloud site name)')
    .option('--no-start', 'Do not start the local site after cloning')
    .option('--force', 'Overwrite existing local instance')
    .option('--include <pattern...>', 'Include patterns for rsync (e.g. .git)')
    .action(async (cloudSiteArg: string, opts: any) => {
      requireAuth();

      if (!checkRsync()) {
        error('rsync is required for sync on macOS/Linux. Install: brew install rsync (macOS) or your distro package.');
        process.exit(1);
      }

      // 1. Resolve cloud site
      const spin = spinner('Resolving cloud site...');
      spin.start();
      let site;
      try {
        site = await resolveSite(cloudSiteArg);
        spin.succeed(`Cloud site: ${site.name || site.sub_domain} (ID: ${site.id})`);
      } catch {
        spin.fail('Site resolution failed');
        process.exit(1);
      }

      // 2. Create local instance
      const instances = getLocalInstances();
      const name = sanitizeName(opts.name || site.name || site.sub_domain || `site-${site.id}`);

      if (instances[name]) {
        if (!opts.force) {
          error(`Local instance "${name}" already exists. Use --force to overwrite or --name to pick a different name.`);
          process.exit(1);
        }
        // Force: delete existing instance first
        stopServerProcess(instances[name]);
        deleteInstanceDir(name);
        removeLocalInstance(name);
        info(`Existing instance "${name}" removed.`);
      }

      const port = await getNextPort(instances);
      const dir = createInstanceDir(name);

      const instance: LocalInstance = {
        name,
        port,
        php: normalizePhpVersion(site.php_version) || '8.3',
        wp: site.wp_version || 'latest',
        path: dir,
        createdAt: new Date().toISOString(),
      };
      setLocalInstance(instance);
      success(`Local instance "${name}" created`);

      // 3. Get SSH access
      const conn = await ensureSshAccess(site.id);

      // 4. Export database from cloud
      const dumpPath = join(dir, 'database.sql');
      const dbSpin = spinner('Exporting database...');
      dbSpin.start();
      try {
        const wpPath = `/home/${conn.username}/web/${conn.domain}/public_html`;
        const { exitCode, stderr } = execViaSshToFile(
          conn,
          `cd ${wpPath} && wp db export --single-transaction -`,
          dumpPath,
        );
        if (exitCode !== 0) {
          dbSpin.fail('Database export failed (will start with fresh DB)');
          if (stderr) info(stderr.trim());
        } else {
          const size = statSync(dumpPath).size;
          dbSpin.succeed(`Database exported (${(size / 1024 / 1024).toFixed(1)} MB)`);
        }
      } catch (err: any) {
        dbSpin.fail('Database export failed: ' + err.message);
      }

      // 5. Pull wp-content via rsync
      const localWpContent = join(dir, 'wp-content') + '/';
      const remotePath = `/home/${conn.username}/web/${conn.domain}/public_html/wp-content/`;
      const remoteSource = `${conn.username}@${conn.host}:${remotePath}`;

      info(`Pulling wp-content from ${chalk.dim(conn.domain)}...`);
      const includeArgs: string[] = [];
      if (opts.include) {
        for (const pattern of opts.include) {
          includeArgs.push(`--include=${pattern}`);
        }
      }
      const rsyncExit = await syncFiles(conn, remoteSource, localWpContent, [
        ...includeArgs,
        '--exclude=cache',
        '--exclude=upgrade',
        '--exclude=wflogs',
        '--exclude=backup*',
      ], false, true);

      if (rsyncExit !== 0) {
        error(`wp-content sync failed (exit code ${rsyncExit})`);
      }

      // 5b. Pull non-core root files (CLAUDE.md, .htaccess, wp-cli.yml, etc.)
      const remoteRoot = `/home/${conn.username}/web/${conn.domain}/public_html/`;
      const rootRemote = `${conn.username}@${conn.host}:${remoteRoot}`;
      await syncFiles(conn, rootRemote, dir + '/', [
        '--exclude=wp-admin/',
        '--exclude=wp-includes/',
        '--exclude=wp-content/',
        '--exclude=wp-*.php',
        '--exclude=index.php',
        '--exclude=xmlrpc.php',
        '--exclude=license.txt',
        '--exclude=readme.html',
      ], false, false);

      // 6. Ensure auto-login mu-plugin
      ensureAutoLogin(instance);

      // 7. Convert MySQL dump → SQLite, import directly, fix URLs and table prefix
      const hasDump = existsSync(dumpPath) && statSync(dumpPath).size > 0;
      let adminUsername = 'admin';
      if (hasDump) {
        const dbSpin2 = spinner('Importing database...');
        dbSpin2.start();
        try {
          const mysql2sqlitePath = resolveFromModule(import.meta.url, '..', '..', 'scripts', 'mysql2sqlite');
          const dbDir = join(dir, 'wp-content', 'database');
          const sqliteDbPath = join(dbDir, '.ht.sqlite');

          // Clean slate for database dir
          if (existsSync(dbDir)) rmSync(dbDir, { recursive: true, force: true });
          mkdirSync(dbDir, { recursive: true });

          // Strip SSH MOTD from dump
          const rawDump = readFileSync(dumpPath, 'utf-8');
          const sqlStart = rawDump.search(/^(\/\*|--|CREATE |DROP |SET |INSERT )/m);
          if (sqlStart > 0) {
            writeFileSync(dumpPath, rawDump.substring(sqlStart));
          }

          // Convert MySQL → SQLite via awk (mysql2sqlite is an awk script).
          // Windows doesn't honor shebangs, so invoke awk explicitly.
          const awk = findAwk();
          if (!awk) {
            throw new Error('awk not found. ' + (process.platform === 'win32'
              ? 'Reinstall the CLI — the bundled busybox.exe is missing.'
              : 'Install awk/gawk.'));
          }
          const convertResult = spawnSync(awk.cmd, [...awk.prefixArgs, '-f', mysql2sqlitePath, dumpPath], {
            encoding: 'utf-8',
            maxBuffer: 500 * 1024 * 1024,
            timeout: 120000,
          });
          if (convertResult.status !== 0) {
            throw new Error(convertResult.stderr || 'mysql2sqlite conversion failed');
          }

          // Add DROP TABLE before each CREATE TABLE
          let sqliteSql = convertResult.stdout;
          sqliteSql = sqliteSql.replace(
            /^(CREATE TABLE `([^`]+)`)/gm,
            'DROP TABLE IF EXISTS `$2`;\n$1',
          );

          // Import directly via better-sqlite3 (no external sqlite3 CLI needed)
          const db = new Database(sqliteDbPath);
          try {
            db.exec(sqliteSql);

            // Find the table prefix and rename to wp_
            const tableRows = db.prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            ).all() as { name: string }[];
            const allTables = tableRows.map(r => r.name);
            const optionsTable = allTables.find(t => t.endsWith('_options'));
            const oldPrefix = optionsTable ? optionsTable.replace('options', '') : 'wp_';

            if (oldPrefix !== 'wp_') {
              const renames = allTables
                .filter(t => t.startsWith(oldPrefix))
                .map(t => `ALTER TABLE \`${t}\` RENAME TO \`wp_${t.substring(oldPrefix.length)}\``);
              db.exec(renames.join(';\n') + ';');

              // Rename meta keys and option names that contain the old prefix
              db.prepare(
                'UPDATE wp_usermeta SET meta_key = REPLACE(meta_key, ?, ?) WHERE meta_key LIKE ?',
              ).run(oldPrefix, 'wp_', oldPrefix + '%');
              db.prepare(
                'UPDATE wp_options SET option_name = REPLACE(option_name, ?, ?) WHERE option_name LIKE ?',
              ).run(oldPrefix, 'wp_', oldPrefix + '%');
            }

            // Search-replace old cloud URL → localhost (bound params: no SQL injection)
            const localUrl = `http://127.0.0.1:${instance.port}`;
            const oldDomain = site.url || site.sub_domain || '';
            const oldUrls = [
              oldDomain,
              oldDomain.replace('https://', 'http://'),
            ].filter(Boolean);

            const replaceStmts = [
              'UPDATE wp_options SET option_value = REPLACE(option_value, ?, ?) WHERE option_value LIKE ?',
              'UPDATE wp_posts SET post_content = REPLACE(post_content, ?, ?) WHERE post_content LIKE ?',
              'UPDATE wp_posts SET guid = REPLACE(guid, ?, ?) WHERE guid LIKE ?',
              'UPDATE wp_postmeta SET meta_value = REPLACE(meta_value, ?, ?) WHERE meta_value LIKE ?',
              'UPDATE wp_comments SET comment_content = REPLACE(comment_content, ?, ?) WHERE comment_content LIKE ?',
            ].map(s => db.prepare(s));

            for (const oldUrl of oldUrls) {
              const likePattern = '%' + oldUrl + '%';
              for (const stmt of replaceStmts) {
                stmt.run(oldUrl, localUrl, likePattern);
              }
            }
            db.prepare(
              "UPDATE wp_options SET option_value = ? WHERE option_name IN ('siteurl','home')",
            ).run(localUrl);

            // Get admin username for blueprint login step
            const adminRow = db.prepare(
              "SELECT user_login FROM wp_users WHERE ID = (SELECT user_id FROM wp_usermeta WHERE meta_key = 'wp_capabilities' AND meta_value LIKE '%administrator%' LIMIT 1)",
            ).get() as { user_login?: string } | undefined;
            adminUsername = adminRow?.user_login || 'admin';

            const tableCount = (db.prepare(
              "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'",
            ).get() as { c: number }).c;

            dbSpin2.succeed(`Database imported (${tableCount} tables, admin: ${adminUsername})`);
          } finally {
            db.close();
          }
        } catch (err: any) {
          dbSpin2.fail('Database import failed: ' + err.message);
        }
      }

      // 8. Write clone blueprint with AST driver + login as actual admin user
      const cloneBlueprintPath = join(dir, 'clone-blueprint.json');
      const cloneBlueprint = {
        steps: [
          {
            step: 'defineWpConfigConsts',
            consts: {
              WP_SQLITE_AST_DRIVER: true,
              WP_DEBUG: false,
              WP_DEBUG_DISPLAY: false,
            },
          },
          {
            step: 'login',
            username: adminUsername,
          },
        ],
      };
      writeFileSync(cloneBlueprintPath, JSON.stringify(cloneBlueprint));

      // 9. Write error suppression mu-plugin
      const muDir = join(dir, 'wp-content', 'mu-plugins');
      mkdirSync(muDir, { recursive: true });
      writeFileSync(join(muDir, '0-suppress-errors.php'),
        "<?php\nerror_reporting(E_ERROR | E_PARSE);\n@ini_set('display_errors', '0');\n");

      console.log(`
${chalk.bold.green('Clone complete!')}

  ${chalk.dim('Name:')}        ${name}
  ${chalk.dim('PHP:')}         ${instance.php}
  ${chalk.dim('WordPress:')}   ${instance.wp}
  ${chalk.dim('Port:')}        ${port}
  ${chalk.dim('Data:')}        ${chalk.dim(dir)}
  ${chalk.dim('Admin:')}       ${adminUsername}
`);

      if (opts.start !== false) {
        printUrls(port);
        console.log(chalk.dim('\nPress Ctrl+C to stop.\n'));

        try {
          await startServer(instance, {
            blueprint: cloneBlueprintPath,
            onReady: (url: string) => openWpAdmin(url),
          });
        } catch (err: any) {
          error('Failed to start local site', err.message);
          process.exit(1);
        }
      } else {
        info(`Start with: instawp local start ${name}`);
      }
    });
}

function checkRsync(): boolean {
  // Windows transfers go over pure-JS SFTP, so rsync isn't required there.
  if (process.platform === 'win32') return true;
  const result = spawnSync('which', ['rsync'], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * Locate an awk-compatible interpreter. Resolution order:
 *   1. Bundled BusyBox-w64 in bin/win32/ (Windows only — invoked as `busybox awk`)
 *   2. `awk` or `gawk` in PATH
 *   3. Common Git-for-Windows install dirs (Windows only)
 *
 * Returns the command path plus any arg-prefix that must precede the awk
 * arguments (busybox uses `busybox awk -f script input`).
 */
function findAwk(): { cmd: string; prefixArgs: string[] } | null {
  const bb = bundledBusybox();
  if (bb) return { cmd: bb, prefixArgs: ['awk'] };

  const cmd = process.platform === 'win32' ? 'where' : 'which';
  for (const name of ['awk', 'gawk']) {
    const r = spawnSync(cmd, [name], { stdio: 'pipe' });
    if (r.status === 0) return { cmd: name, prefixArgs: [] };
  }
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Git\\usr\\bin\\awk.exe',
      'C:\\Program Files (x86)\\Git\\usr\\bin\\awk.exe',
    ];
    if (process.env.PROGRAMFILES) {
      candidates.push(process.env.PROGRAMFILES + '\\Git\\usr\\bin\\awk.exe');
    }
    for (const c of candidates) {
      if (existsSync(c)) return { cmd: c, prefixArgs: [] };
    }
  }
  return null;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

// Playground supports: 7.4, 8.0, 8.1, 8.2, 8.3, 8.4, 8.5
const PLAYGROUND_PHP_VERSIONS = ['7.4', '8.0', '8.1', '8.2', '8.3', '8.4', '8.5'];

function normalizePhpVersion(version?: string): string {
  if (!version) return '8.3';
  // Extract major.minor (e.g., "8.2.15" → "8.2")
  const match = version.match(/^(\d+\.\d+)/);
  const majorMinor = match ? match[1] : version;
  if (PLAYGROUND_PHP_VERSIONS.includes(majorMinor)) return majorMinor;
  // Fall back to closest supported version, prefer not going higher
  return '8.3';
}

function nextAutoName(instances: Record<string, LocalInstance>): string {
  let i = 1;
  while (instances[`insta-local-site-${i}`]) i++;
  return `insta-local-site-${i}`;
}

function printUrls(port: number): void {
  const url = `http://127.0.0.1:${port}`;
  console.log(`  ${chalk.dim('Site:')}     ${chalk.cyan.underline(url)}`);
  console.log(`  ${chalk.dim('WP Admin:')} ${chalk.cyan.underline(`${url}/?instawp-login`)}`);
}

async function launchServer(instance: LocalInstance, opts: any): Promise<void> {
  const shouldOpen = opts.open !== false;
  const json = isJsonMode();

  if (opts.background) {
    const spin = json ? null : spinner(`Starting "${instance.name}" in background...`);
    spin?.start();
    try {
      const { pid, url } = await startServerBackground(instance, opts.blueprint);
      if (json) {
        console.log(JSON.stringify({
          success: true,
          data: {
            name: instance.name,
            url,
            port: instance.port,
            pid,
            wp: instance.wp,
            php: instance.php,
            path: instance.path,
          },
        }));
      } else {
        spin?.succeed(`Running in background (PID: ${pid})`);
        printUrls(instance.port);
        info(`Stop with: instawp local stop ${instance.name}`);
        info(`Logs: ${instance.path}/server.log`);
      }
      if (shouldOpen) await openWpAdmin(url);
    } catch (err: any) {
      if (json) {
        console.log(JSON.stringify({ success: false, error: err.message }));
      } else {
        spin?.fail('Failed to start');
        error(err.message);
      }
      process.exit(1);
    }
  } else {
    if (!json) {
      printUrls(instance.port);
      console.log(chalk.dim('\nPress Ctrl+C to stop.\n'));
    }
    try {
      await startServer(instance, {
        blueprint: opts.blueprint,
        onReady: shouldOpen ? (url: string) => openWpAdmin(url) : undefined,
      });
    } catch (err: any) {
      error('Failed to start local site', err.message);
      process.exit(1);
    }
  }
}

async function openWpAdmin(serverUrl: string): Promise<void> {
  // Use the magic login URL — hits frontend (no auth wall),
  // sets cookie via mu-plugin, then redirects to wp-admin
  const loginUrl = `${serverUrl}/?instawp-login`;

  // Wait for WordPress to be fully ready
  for (let i = 0; i < 30; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(serverUrl, {
        signal: controller.signal,
        redirect: 'manual',
      });
      clearTimeout(timer);
      if (res.status === 200 || res.status === 302) {
        break;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  open(loginUrl).catch(() => {});
}
