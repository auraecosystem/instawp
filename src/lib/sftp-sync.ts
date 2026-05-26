import SftpClient from 'ssh2-sftp-client';
// ssh2 is CommonJS — a named ESM import fails at runtime. Use default import.
import ssh2 from 'ssh2';
const ssh2Utils = ssh2.utils;
import { readFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { SshConnection } from '../types.js';

interface SftpAuth {
  privateKey?: Buffer;
  passphrase?: string;
  agent?: string;
}

/**
 * Build the SSH auth for ssh2. Unencrypted keys (the CLI's own generated
 * cli_key) are passed directly. If the key is encrypted, we don't pass it
 * (ssh2 throws at parse time) — instead we fall back to ssh-agent, which is
 * how rsync/ssh transparently handle encrypted keys. Set INSTAWP_SSH_PASSPHRASE
 * to use an encrypted key without an agent.
 */
function buildAuth(conn: SshConnection): SftpAuth {
  const auth: SftpAuth = {};
  const passphrase = process.env.INSTAWP_SSH_PASSPHRASE || undefined;
  try {
    const keyContent = readFileSync(conn.privateKeyPath);
    const parsed = ssh2Utils.parseKey(keyContent, passphrase);
    if (!(parsed instanceof Error)) {
      auth.privateKey = keyContent;
      if (passphrase) auth.passphrase = passphrase;
    }
  } catch {
    // key file unreadable — rely on agent below
  }
  // ssh-agent fallback (also covers encrypted keys already loaded in the agent)
  const agentSock = process.platform === 'win32'
    ? '\\\\.\\pipe\\openssh-ssh-agent'
    : process.env.SSH_AUTH_SOCK;
  if (agentSock) auth.agent = agentSock;
  return auth;
}

export interface SftpSyncOptions {
  direction: 'push' | 'pull';
  /** Local directory (contents are synced; trailing slash optional). */
  localPath: string;
  /** Remote directory (POSIX path). */
  remotePath: string;
  /** Names/globs to skip (rsync --exclude equivalents). */
  excludes: string[];
  /** Names/globs that override excludes (rsync --include equivalents). */
  includes?: string[];
  dryRun: boolean;
  /** Called per transferred file/dir for itemized output. */
  onItem?: (action: string, relPath: string) => void;
}

/**
 * Convert a simple rsync-style pattern to a RegExp.
 * Supports `*` (any chars except /) and `**` (any chars). Trailing `/` and
 * leading `/` are stripped. Patterns without `/` match a path segment anywhere.
 */
function patternToRegExp(pattern: string): { re: RegExp; anchored: boolean } {
  let p = pattern.replace(/\/+$/, '').replace(/^\/+/, '');
  const anchored = pattern.includes('/');
  // Escape regex specials except * and ?
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') { re += '.*'; i++; } else { re += '[^/]*'; }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return { re: new RegExp('^' + re + '$'), anchored };
}

export function makeMatcher(patterns: string[]): (name: string, relPath: string) => boolean {
  const compiled = patterns.map(patternToRegExp);
  return (name: string, relPath: string) => {
    for (const { re, anchored } of compiled) {
      if (anchored) {
        if (re.test(relPath)) return true;
      } else if (re.test(name)) {
        return true;
      }
    }
    return false;
  };
}

interface TransferTask {
  remote: string;
  local: string;
  rel: string;
}

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;

function resolveConcurrency(): number {
  const raw = parseInt(process.env.INSTAWP_SFTP_CONCURRENCY || '', 10);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_CONCURRENCY;
  return Math.min(raw, MAX_CONCURRENCY);
}

/**
 * Recursively transfer a directory tree over SFTP. This is the Windows
 * replacement for rsync-over-ssh: bundled msys rsync can't talk to native
 * Windows OpenSSH (incompatible pipe/signal semantics), so on Windows we use
 * a pure-JS SSH client instead. No delta algorithm — full-file copy — but
 * reliable and dependency-free of native binaries.
 *
 * Strategy: one "control" connection walks the tree (cheap listing) and
 * pre-creates directories, building a flat list of file tasks. Files are then
 * transferred across a pool of N parallel connections (INSTAWP_SFTP_CONCURRENCY,
 * default 4) to hide per-file SSH round-trip latency.
 */
export async function syncViaSftp(conn: SshConnection, opts: SftpSyncOptions): Promise<number> {
  const isExcluded = makeMatcher(opts.excludes);
  const isIncluded = makeMatcher(opts.includes ?? []);
  const skip = (name: string, relPath: string): boolean => {
    if (isIncluded(name, relPath)) return false;
    return isExcluded(name, relPath);
  };

  const auth = buildAuth(conn);
  if (!auth.privateKey && !auth.agent) {
    opts.onItem?.('error',
      'SSH key appears encrypted and no ssh-agent is available. ' +
      'Load the key into ssh-agent, or set INSTAWP_SSH_PASSPHRASE.');
    return 1;
  }
  const connectCfg = {
    host: conn.host,
    port: conn.port,
    username: conn.username,
    ...auth,
    readyTimeout: 30000,
  };

  const remoteRoot = opts.remotePath.replace(/\/+$/, '');
  const localRoot = opts.localPath.replace(/[\\/]+$/, '');
  const tasks: TransferTask[] = [];

  // --- Phase 1: walk the tree on a single control connection, build the task
  // list, and pre-create destination directories. ---
  const control = new SftpClient();
  try {
    await control.connect(connectCfg);

    if (opts.direction === 'pull') {
      const walkPull = async (remoteDir: string, localDir: string): Promise<void> => {
        let entries;
        try {
          entries = await control.list(remoteDir);
        } catch {
          return; // remote dir missing — nothing to pull
        }
        if (!opts.dryRun) mkdirSync(localDir, { recursive: true });
        for (const e of entries) {
          const rel = posix.relative(remoteRoot, posix.join(remoteDir, e.name));
          if (skip(e.name, rel)) continue;
          const remoteChild = posix.join(remoteDir, e.name);
          const localChild = join(localDir, e.name);
          if (e.type === 'd') {
            await walkPull(remoteChild, localChild);
          } else if (e.type === '-') {
            tasks.push({ remote: remoteChild, local: localChild, rel });
          }
          // symlinks (type 'l') are skipped — rare in wp-content
        }
      };
      await walkPull(remoteRoot, localRoot);
    } else {
      // Push: walk the local tree (fs, no round-trips) and collect remote dirs.
      const remoteDirs = new Set<string>();
      const walkPush = (localDir: string, remoteDir: string): void => {
        if (!existsSync(localDir)) return;
        remoteDirs.add(remoteDir);
        for (const entry of readdirSync(localDir, { withFileTypes: true })) {
          const localChild = join(localDir, entry.name);
          const remoteChild = posix.join(remoteDir, entry.name);
          const rel = posix.relative(remoteRoot, remoteChild);
          if (skip(entry.name, rel)) continue;
          if (entry.isDirectory()) {
            walkPush(localChild, remoteChild);
          } else if (entry.isFile()) {
            tasks.push({ remote: remoteChild, local: localChild, rel });
          }
        }
      };
      walkPush(localRoot, remoteRoot);

      // Pre-create remote dirs shallow-first so parallel uploads have targets.
      if (!opts.dryRun) {
        for (const dir of [...remoteDirs].sort((a, b) => a.length - b.length)) {
          try {
            if (!(await control.exists(dir))) await control.mkdir(dir, true);
          } catch { /* mkdir races / already exists — ignore */ }
        }
      }
    }
  } catch (err: any) {
    opts.onItem?.('error', err?.message || String(err));
    try { await control.end(); } catch { /* ignore */ }
    return 1;
  }

  const total = tasks.length;
  if (opts.dryRun) {
    for (const t of tasks) opts.onItem?.(opts.direction === 'pull' ? 'recv' : 'sent', t.rel);
    try { await control.end(); } catch { /* ignore */ }
    return 0;
  }
  if (total === 0) {
    try { await control.end(); } catch { /* ignore */ }
    return 0;
  }

  // --- Phase 2: transfer files across a pool of N connections. ---
  const concurrency = Math.min(resolveConcurrency(), total);
  const verb = opts.direction === 'pull' ? 'recv' : 'sent';
  const transfer = (c: SftpClient, t: TransferTask) =>
    opts.direction === 'pull' ? c.fastGet(t.remote, t.local) : c.fastPut(t.local, t.remote);

  // Reuse the control connection as the first worker; open the rest.
  const workers: SftpClient[] = [control];
  try {
    for (let i = 1; i < concurrency; i++) {
      const w = new SftpClient();
      await w.connect(connectCfg);
      workers.push(w);
    }
  } catch (err: any) {
    // If extra workers fail to connect, proceed with whatever connected.
    opts.onItem?.('error', `only ${workers.length}/${concurrency} connections opened: ${err?.message || err}`);
  }

  let next = 0;
  let done = 0;
  let errors = 0;
  const runWorker = async (c: SftpClient): Promise<void> => {
    while (true) {
      const i = next++; // synchronous claim — safe in single-threaded JS
      if (i >= total) break;
      const t = tasks[i];
      try {
        await transfer(c, t);
        done++;
        opts.onItem?.(verb, `[${done}/${total}] ${t.rel}`);
      } catch (e: any) {
        errors++;
        opts.onItem?.('error', `${t.rel}: ${e?.message || e}`);
      }
    }
  };

  try {
    await Promise.all(workers.map(runWorker));
  } finally {
    await Promise.all(workers.map(w => w.end().catch(() => {})));
  }

  return errors === 0 ? 0 : 1;
}
