import Conf from 'conf';
import type { UserInfo, SshConnectionCache } from '../types.js';

const SSH_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const config = new Conf({
  projectName: 'instawp',
  schema: {
    api_url: { type: 'string', default: 'https://app.instawp.io' },
    token: { type: 'string', default: '' },
    user: { type: 'object', default: {} },
    ssh_cache: { type: 'object', default: {} },
  },
});

export function getToken(): string | null {
  const envToken = process.env.INSTAWP_TOKEN;
  if (envToken) return envToken;
  const token = config.get('token') as string;
  return token || null;
}

export function getApiUrl(): string {
  return (process.env.INSTAWP_API_URL || config.get('api_url')) as string;
}

export function setToken(token: string): void {
  config.set('token', token);
}

export function setUser(user: UserInfo): void {
  config.set('user', user);
}

export function getUser(): UserInfo | null {
  const user = config.get('user') as UserInfo;
  if (user && user.id) return user;
  return null;
}

export function setApiUrl(url: string): void {
  config.set('api_url', url);
}

export function clearConfig(): void {
  config.clear();
}

export function getSshCache(siteId: number): SshConnectionCache | null {
  const cache = config.get('ssh_cache') as Record<string, SshConnectionCache>;
  const entry = cache?.[String(siteId)];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > SSH_CACHE_TTL) {
    clearSshCache(siteId);
    return null;
  }
  return entry;
}

export function setSshCache(siteId: number, entry: SshConnectionCache): void {
  const cache = (config.get('ssh_cache') as Record<string, SshConnectionCache>) || {};
  cache[String(siteId)] = entry;
  config.set('ssh_cache', cache);
}

export function clearSshCache(siteId?: number): void {
  if (siteId !== undefined) {
    const cache = (config.get('ssh_cache') as Record<string, SshConnectionCache>) || {};
    delete cache[String(siteId)];
    config.set('ssh_cache', cache);
  } else {
    config.set('ssh_cache', {});
  }
}
