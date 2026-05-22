import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import type { SshConnection } from '../types.js';
import { toRsyncPath } from './paths.js';
import { bundledRsync } from './windows-binaries.js';

const KNOWN_HOSTS = path.join(homedir(), '.instawp', 'known_hosts');

// Paths embedded into the rsync `-e ssh ...` command are parsed by rsync's
// internal shell (msys/cygwin sh on Windows), where backslashes are escapes.
// Use forward slashes throughout. The actual ssh.exe on Windows accepts both.
function toSshPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function ensureKnownHosts(): void {
  const dir = path.dirname(KNOWN_HOSTS);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function sshArgs(conn: SshConnection): string[] {
  ensureKnownHosts();
  return [
    '-i', conn.privateKeyPath,
    '-p', String(conn.port),
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${KNOWN_HOSTS}`,
  ];
}

function sshTarget(conn: SshConnection): string {
  return `${conn.username}@${conn.host}`;
}

export function spawnInteractiveSsh(conn: SshConnection): number {
  const result = spawnSync('ssh', [...sshArgs(conn), sshTarget(conn)], {
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

export function execViaSsh(conn: SshConnection, command: string): { stdout: string; stderr: string; exitCode: number } {
  // Pipe command via stdin with -T (no PTY) — InstaWP servers require this
  // instead of passing command as SSH args
  const result = spawnSync('ssh', ['-T', ...sshArgs(conn), sshTarget(conn)], {
    input: command + '\n',
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status ?? 1,
  };
}

/**
 * Execute a command via SSH and stream stdout directly to a file.
 * Useful for large outputs like database dumps.
 */
export function execViaSshToFile(conn: SshConnection, command: string, outputPath: string): { exitCode: number; stderr: string } {
  ensureKnownHosts();
  const fd = openSync(outputPath, 'w');
  try {
    const result = spawnSync('ssh', ['-T', ...sshArgs(conn), sshTarget(conn)], {
      input: command + '\n',
      stdio: ['pipe', fd, 'pipe'],
      encoding: 'utf-8',
      maxBuffer: 500 * 1024 * 1024, // 500MB
    });
    return {
      exitCode: result.status ?? 1,
      stderr: (result.stderr as string) || '',
    };
  } finally {
    closeSync(fd);
  }
}

export function rsyncViaSsh(
  conn: SshConnection,
  source: string,
  dest: string,
  extraArgs: string[],
  dryRun: boolean,
  stream: boolean,
): number {
  ensureKnownHosts();
  const keyPath = toSshPath(conn.privateKeyPath);
  const knownHosts = toSshPath(KNOWN_HOSTS);
  const sshCmd = `ssh -i "${keyPath}" -p ${conn.port} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${knownHosts}"`;

  const args = [
    '-arz',
    '--itemize-changes',
    '--exclude=.git',
    '--exclude=node_modules',
    '--exclude=.DS_Store',
    ...(dryRun ? ['--dry-run'] : []),
    ...extraArgs,
    '-e', sshCmd,
    toRsyncPath(source),
    toRsyncPath(dest),
  ];

  const result = spawnSync(bundledRsync() ?? 'rsync', args, {
    stdio: stream ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    encoding: stream ? undefined : 'utf-8',
  });

  if (!stream && result.stdout) {
    console.log(result.stdout);
  }
  if (!stream && result.stderr && result.status !== 0) {
    console.error(result.stderr);
  }

  return result.status ?? 1;
}
