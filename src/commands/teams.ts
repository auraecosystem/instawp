import { Command } from 'commander';
import { requireAuth, getClient } from '../lib/api.js';
import { success, error, table, spinner, isJsonMode } from '../lib/output.js';

async function fetchTeams(): Promise<{ teams: any[]; current_team_id: number | null }> {
  const client = getClient();
  const res = await client.get('/teams');
  return {
    teams: res.data?.data || [],
    current_team_id: res.data?.current_team_id ?? null,
  };
}

async function resolveTeamId(teamArg: string): Promise<number> {
  // If numeric, use directly
  if (/^\d+$/.test(teamArg)) {
    return parseInt(teamArg, 10);
  }

  // Otherwise, fetch teams and match by name (case-insensitive)
  const { teams } = await fetchTeams();
  const matches = teams.filter(
    (t: any) => t.name.toLowerCase() === teamArg.toLowerCase(),
  );

  if (matches.length === 0) {
    error(`No team found matching "${teamArg}"`);
    process.exit(1);
  }
  if (matches.length > 1) {
    error(`Multiple teams match "${teamArg}". Use team ID instead.`);
    process.exit(1);
  }

  return matches[0].id;
}

export function registerTeamsCommand(program: Command): void {
  const teams = program
    .command('teams')
    .description('Manage teams');

  // teams list
  teams
    .command('list')
    .description('List all teams')
    .action(async () => {
      requireAuth();
      const spin = spinner('Fetching teams...');
      spin.start();

      try {
        const { teams: teamList, current_team_id } = await fetchTeams();
        spin.stop();

        if (teamList.length === 0) {
          if (isJsonMode()) {
            console.log(JSON.stringify([]));
          } else {
            success('No teams found.');
          }
          return;
        }

        if (isJsonMode()) {
          const rows = teamList.map((t: any) => ({
            id: t.id,
            name: t.name,
            created_at: t.created_at || '',
            is_current: t.id === current_team_id,
          }));
          console.log(JSON.stringify(rows));
          return;
        }

        const rows = teamList.map((t: any) => ({
          id: t.id,
          name: t.id === current_team_id ? `${t.name} (current)` : t.name,
          created_at: t.created_at || '',
        }));

        table(['ID', 'Name', 'Created At'], rows);
      } catch (err: any) {
        spin.fail('Failed to fetch teams');
        error('Could not list teams', err.response?.data?.message || err.message);
        process.exit(1);
      }
    });

  // teams members <team>
  teams
    .command('members <team>')
    .description('List members of a team (by ID or name)')
    .action(async (teamArg: string) => {
      requireAuth();
      const spin = spinner('Fetching team members...');
      spin.start();

      try {
        const teamId = await resolveTeamId(teamArg);
        const client = getClient();
        const res = await client.get(`/teams/${teamId}/members`);
        spin.stop();

        const members = res.data?.data || [];

        if (members.length === 0) {
          if (isJsonMode()) {
            console.log(JSON.stringify([]));
          } else {
            success('No members found.');
          }
          return;
        }

        if (isJsonMode()) {
          const rows = members.map((m: any) => ({
            id: m.id,
            name: m.name || '',
            email: m.email || '',
          }));
          console.log(JSON.stringify(rows));
          return;
        }

        const rows = members.map((m: any) => ({
          id: m.id,
          name: m.name || '',
          email: m.email || '',
        }));

        table(['ID', 'Name', 'Email'], rows);
      } catch (err: any) {
        spin.fail('Failed to fetch team members');
        error('Could not list team members', err.response?.data?.message || err.message);
        process.exit(1);
      }
    });
}
