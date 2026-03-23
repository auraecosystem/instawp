import { Command } from 'commander';
import { requireAuth, getClient } from '../lib/api.js';
import { getTeamId, setTeamId, clearTeamId } from '../lib/config.js';
import { success, error, table, spinner, info, isJsonMode } from '../lib/output.js';

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

        const cliTeamId = getTeamId();
        const activeTeamId = cliTeamId || current_team_id;

        if (isJsonMode()) {
          const rows = teamList.map((t: any) => ({
            id: t.id,
            name: t.name,
            created_at: t.created_at || '',
            is_active: t.id === activeTeamId,
          }));
          console.log(JSON.stringify(rows));
          return;
        }

        const rows = teamList.map((t: any) => ({
          id: t.id,
          name: t.id === activeTeamId ? `${t.name} (active)` : t.name,
          created_at: t.created_at || '',
        }));

        table(['ID', 'Name', 'Created At'], rows);
        if (cliTeamId) {
          info(`CLI team context set to ID ${cliTeamId}. Run 'teams switch' to clear.`);
        }
      } catch (err: any) {
        spin.fail('Failed to fetch teams');
        error('Could not list teams', err.response?.data?.message || err.message);
        process.exit(1);
      }
    });

  // teams switch <team>
  teams
    .command('switch [team]')
    .description('Switch active team context (by ID or name). Omit to reset.')
    .action(async (teamArg?: string) => {
      requireAuth();

      // No argument = clear team context
      if (!teamArg) {
        clearTeamId();
        if (isJsonMode()) {
          console.log(JSON.stringify({ team_id: null }));
        } else {
          success('Team context cleared. Using default team.');
        }
        return;
      }

      const spin = spinner('Resolving team...');
      spin.start();

      try {
        const teamId = await resolveTeamId(teamArg);
        // Verify the team exists in user's teams
        const { teams: teamList } = await fetchTeams();
        const team = teamList.find((t: any) => t.id === teamId);
        spin.stop();

        if (!team) {
          error(`You don't belong to team "${teamArg}"`);
          process.exit(1);
        }

        setTeamId(teamId);

        if (isJsonMode()) {
          console.log(JSON.stringify({ team_id: team.id, team_name: team.name }));
        } else {
          success(`Switched to team: ${team.name} (ID: ${team.id})`);
        }
      } catch (err: any) {
        spin.fail('Failed to switch team');
        error('Could not switch team', err.response?.data?.message || err.message);
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
