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

/**
 * Recursively transfer a directory tree over SFTP. This is the Windows
 * replacement for rsync-over-ssh: bundled msys rsync can't talk to native
 * Windows OpenSSH (incompatible pipe/signal semantics), so on Windows we use
 * a pure-JS SSH client instead. No delta algorithm — full-file copy — but
 * reliable and dependency-free of native binaries.
 */
export async function syncViaSftp(conn: SshConnection, opts: SftpSyncOptions): Promise<number> {
  const isExcluded = makeMatcher(opts.excludes);
  const isIncluded = makeMatcher(opts.includes ?? []);
  // Always skip these (rsync defaults we hardcoded).
  const skip = (name: string, relPath: string): boolean => {
    if (isIncluded(name, relPath)) return false;
    return isExcluded(name, relPath);
  };

  const client = new SftpClient();
  let transferred = 0;
  const auth = buildAuth(conn);
  if (!auth.privateKey && !auth.agent) {
    opts.onItem?.('error',
      'SSH key appears encrypted and no ssh-agent is available. ' +
      'Load the key into ssh-agent, or set INSTAWP_SSH_PASSPHRASE.');
    return 1;
  }
  try {
    await client.connect({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      ...auth,
      readyTimeout: 30000,
    });

    if (opts.direction === 'pull') {
      const pullDir = async (remoteDir: string, localDir: string): Promise<void> => {
        let entries;
        try {
          entries = await client.list(remoteDir);
        } catch {
          return; // remote dir missing — nothing to pull
        }
        if (!opts.dryRun) mkdirSync(localDir, { recursive: true });
        for (const e of entries) {
          const relPath = posix.relative(opts.remotePath.replace(/\/+$/, ''), posix.join(remoteDir, e.name));
          if (skip(e.name, relPath)) continue;
          const remoteChild = posix.join(remoteDir, e.name);
          const localChild = join(localDir, e.name);
          if (e.type === 'd') {
            await pullDir(remoteChild, localChild);
          } else if (e.type === '-') {
            if (!opts.dryRun) await client.fastGet(remoteChild, localChild);
            transferred++;
            opts.onItem?.('recv', relPath);
          }
          // symlinks (type 'l') are skipped — rare in wp-content
        }
      };
      await pullDir(opts.remotePath.replace(/\/+$/, ''), opts.localPath.replace(/[\\/]+$/, ''));
    } else {
      const remoteRoot = opts.remotePath.replace(/\/+$/, '');
      const localRoot = opts.localPath.replace(/[\\/]+$/, '');
      const pushDir = async (localDir: string, remoteDir: string): Promise<void> => {
        if (!existsSync(localDir)) return;
        if (!opts.dryRun) {
          const exists = await client.exists(remoteDir);
          if (!exists) await client.mkdir(remoteDir, true);
        }
        for (const entry of readdirSync(localDir, { withFileTypes: true })) {
          const localChild = join(localDir, entry.name);
          const remoteChild = posix.join(remoteDir, entry.name);
          const relPath = posix.relative(remoteRoot, remoteChild);
          if (skip(entry.name, relPath)) continue;
          if (entry.isDirectory()) {
            await pushDir(localChild, remoteChild);
          } else if (entry.isFile()) {
            if (!opts.dryRun) await client.fastPut(localChild, remoteChild);
            transferred++;
            opts.onItem?.('sent', relPath);
          }
        }
      };
      await pushDir(localRoot, remoteRoot);
    }

    return 0;
  } catch (err: any) {
    opts.onItem?.('error', err?.message || String(err));
    return 1;
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}
