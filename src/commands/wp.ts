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
          // Print raw command output
          if (Array.isArray(data)) {
            for (const result of data) {
              if (result.output) console.log(result.output);
            }
          } else if (data?.output) {
            console.log(data.output);
          } else if (typeof data === 'string') {
            console.log(data);
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
