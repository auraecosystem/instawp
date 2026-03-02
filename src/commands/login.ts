import { Command } from 'commander';
import { startOAuthFlow } from '../lib/auth.js';
import { setToken, setApiUrl, setUser, getApiUrl } from '../lib/config.js';
import { getClient, resetClient } from '../lib/api.js';
import { success, error, spinner, info } from '../lib/output.js';

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Authenticate with InstaWP')
    .option('--token <token>', 'API token (skip browser login)')
    .option('--api-url <url>', 'API base URL')
    .action(async (opts) => {
      try {
        if (opts.apiUrl) {
          setApiUrl(opts.apiUrl);
          resetClient();
        }

        let token: string;

        if (opts.token) {
          token = opts.token;
        } else {
          info(`Opening browser for authentication at ${getApiUrl()}...`);
          const spin = spinner('Waiting for browser authentication...');
          spin.start();
          try {
            token = await startOAuthFlow();
            spin.succeed('Browser authentication successful');
          } catch (err: any) {
            spin.fail('Browser authentication failed');
            error(err.message);
            process.exit(1);
          }
        }

        setToken(token);
        resetClient();

        // Validate token
        const spin2 = spinner('Validating token...');
        spin2.start();
        try {
          const client = getClient();
          const res = await client.get('/sites', { params: { per_page: 1 } });
          spin2.succeed('Token validated');

          // Try to extract user info from response if available
          // The sites endpoint may return user info in the meta/auth context
          // If not, we at least know the token is valid
          success('Logged in successfully', {
            api_url: getApiUrl(),
          });
        } catch (err: any) {
          spin2.fail('Token validation failed');
          error('Invalid token. Please check and try again.');
          process.exit(1);
        }
      } catch (err: any) {
        error('Login failed', err.message);
        process.exit(1);
      }
    });
}
