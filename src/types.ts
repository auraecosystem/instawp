export interface CliConfig {
  api_url: string;
  token: string | null;
  user: UserInfo | null;
}

export interface UserInfo {
  id: number;
  name: string;
  email: string;
}

export interface Site {
  id: number;
  domain: string;
  url: string;
  status: string;
  wp_version: string;
  php_version: string;
  created_at: string;
}

export interface SiteCreateParams {
  site_name: string;
  php_version?: string;
  plan_id?: number;
  configuration_id?: number;
}

export interface SftpCredentials {
  host: string;
  username: string;
  password: string;
  port: number;
}

export interface RunCmdResult {
  output: string;
  exit_code: number;
}

export interface ApiResponse<T = any> {
  status: boolean;
  data: T;
  message?: string;
}
