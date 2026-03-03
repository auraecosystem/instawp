import { Command } from 'commander';
import { requireAuth, getClient } from '../lib/api.js';
import { success, error, spinner, isJsonMode } from '../lib/output.js';

export function registerWpCommand(program: Command): void {
  program
    .command('wp <site> [args...]')
    .description('Run WP-CLI commands on a remote site')
    .passThroughOptions()
    .allowUnknownOption()
    .option('--timeout <seconds>', 'Command timeout in seconds', '30')
    .action(async (site: string, args: string[], opts) => {
      requireAuth();

      const wpCommand = 'wp ' + args.join(' ');
      const spin = spinner(`Running: ${wpCommand}`);
      spin.start();

      try {
        const client = getClient();
        const res = await client.post(`/sites/${site}/run-cmd`, {
          commands: [wpCommand],
          timeout_seconds: parseInt(opts.timeout),
        });

        spin.stop();

        const data = res.data?.data;
        // The API returns command output - could be array of results or single result
        if (isJsonMode()) {
          console.log(JSON.stringify({ success: true, data }));
        } else {
          // Print raw command output, stripping the timestamp+command echo line
          const stripEcho = (s: string) => {
            const lines = s.split('\n');
            // First line is typically "YYYY-MM-DD HH:MM:SS wp ..." echo — skip it
            if (lines[0] && /^\d{4}-\d{2}-\d{2}\s/.test(lines[0])) {
              return lines.slice(1).join('\n').trim();
            }
            return s.trim();
          };
          if (Array.isArray(data)) {
            for (const result of data) {
              const output = result.output || result;
              console.log(typeof output === 'string' ? stripEcho(output) : JSON.stringify(output));
            }
          } else if (typeof data === 'string') {
            console.log(stripEcho(data));
          } else if (data?.output) {
            console.log(typeof data.output === 'string' ? stripEcho(data.output) : JSON.stringify(data.output));
          } else {
            console.log(JSON.stringify(data, null, 2));
          }
        }
      } catch (err: any) {
        spin.fail('Command failed');
        error('Failed to run WP-CLI command', err.response?.data?.message || err.message);
        process.exit(1);
      }
    });
}
