import Conf from 'conf';
import type { UserInfo } from '../types.js';

const config = new Conf({
  projectName: 'instawp',
  schema: {
    api_url: { type: 'string', default: 'https://app.instawp.io' },
    token: { type: 'string', default: '' },
    user: { type: 'object', default: {} },
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
