import axios, { AxiosInstance, AxiosError } from 'axios';
import { getToken, getApiUrl, getTeamId, clearConfig } from './config.js';
import { error } from './output.js';

let client: AxiosInstance | null = null;

export function getClient(): AxiosInstance {
  if (client) return client;

  const baseURL = `${getApiUrl()}/api/v2`;
  client = axios.create({
    baseURL,
    timeout: 30000,
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
  });

  client.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Inject team_id into all requests if set
    const teamId = getTeamId();
    if (teamId) {
      config.params = { ...config.params, team_id: teamId };
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    (err: AxiosError) => {
      if (err.response?.status === 401) {
        clearConfig();
        error('Authentication expired. Run `instawp login` to re-authenticate.');
        process.exit(1);
      }
      if (err.response?.status === 429) {
        error('Rate limited. Please wait and try again.');
        process.exit(1);
      }
      return Promise.reject(err);
    }
  );

  return client;
}

export function resetClient(): void {
  client = null;
}

export function requireAuth(): void {
  const token = getToken();
  if (!token) {
    error('Not authenticated. Run `instawp login` first.');
    process.exit(1);
  }
}
