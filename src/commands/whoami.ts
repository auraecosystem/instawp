import { Command } from 'commander';
import { getToken, getUser, getApiUrl } from '../lib/config.js';
import { requireAuth, getClient } from '../lib/api.js';
import { success, error, spinner, isJsonMode } from '../lib/output.js';

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

        // Fetch team context (non-fatal)
        let teamName: string | undefined;
        let teamId: number | undefined;
        try {
          const teamsRes = await client.get('/teams');
          const currentTeamId = teamsRes.data?.current_team_id;
          if (currentTeamId) {
            const teams = teamsRes.data?.data || [];
            const currentTeam = teams.find((t: any) => t.id === currentTeamId);
            if (currentTeam) {
              teamId = currentTeam.id;
              teamName = currentTeam.name;
            }
          }
        } catch {
          // Team info is non-fatal — skip silently
        }

        const sessionData: Record<string, any> = {
          api_url: getApiUrl(),
          ...(user ? { name: user.name, email: user.email } : {}),
          token: getToken()!.substring(0, 8) + '...',
        };

        if (isJsonMode()) {
          if (teamId) {
            sessionData.team_id = teamId;
            sessionData.team_name = teamName;
          }
        } else {
          if (teamName && teamId) {
            sessionData.team = `${teamName} (ID: ${teamId})`;
          }
        }

        success('Current session', sessionData);
      } catch (err: any) {
        spin.fail('Authentication check failed');
        error('Token is no longer valid. Run `instawp login` to re-authenticate.');
        process.exit(1);
      }
    });
}
