import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { SshConnection } from '../types.js';

const KNOWN_HOSTS = path.join(homedir(), '.instawp', 'known_hosts');

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

export function rsyncViaSsh(
  conn: SshConnection,
  source: string,
  dest: string,
  extraArgs: string[],
  dryRun: boolean,
  stream: boolean,
): number {
  ensureKnownHosts();
  const sshCmd = `ssh -i ${conn.privateKeyPath} -p ${conn.port} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${KNOWN_HOSTS}`;

  const args = [
    '-avz',
    '--exclude=.git',
    '--exclude=node_modules',
    '--exclude=.DS_Store',
    ...(dryRun ? ['--dry-run'] : []),
    ...extraArgs,
    '-e', sshCmd,
    source,
    dest,
  ];

  const result = spawnSync('rsync', args, {
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
