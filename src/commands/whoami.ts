import { Command } from 'commander';
import { getToken, getUser, getApiUrl } from '../lib/config.js';
import { requireAuth, getClient } from '../lib/api.js';
import { success, error, spinner } from '../lib/output.js';

export function registerWhoamiCommand(program: Command): void {
  program
    .command('whoami')
    .description('Show current authenticated user')
    .action(async () => {
      requireAuth();

      const spin = spinner('Checking authentication...');
      spin.start();

      try {
        const client = getClient();
        const res = await client.get('/sites', { params: { per_page: 1 } });
        spin.succeed('Authenticated');

        const user = getUser();
        success('Current session', {
          api_url: getApiUrl(),
          ...(user ? { name: user.name, email: user.email } : {}),
          token: getToken()!.substring(0, 8) + '...',
        });
      } catch (err: any) {
        spin.fail('Authentication check failed');
        error('Token is no longer valid. Run `instawp login` to re-authenticate.');
        process.exit(1);
      }
    });
}
