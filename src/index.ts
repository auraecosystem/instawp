#!/usr/bin/env node

import { Command } from 'commander';
import { setJsonMode } from './lib/output.js';
import { registerLoginCommand } from './commands/login.js';
import { registerWhoamiCommand } from './commands/whoami.js';
import { registerSitesCommand, registerCreateAlias } from './commands/sites.js';
import { registerWpCommand } from './commands/wp.js';
import { registerSyncCommand } from './commands/sync.js';

// Early --json detection so it works in any argv position
if (process.argv.includes('--json')) {
  setJsonMode(true);
  // Remove --json from argv so Commander doesn't choke on it as unknown option
  process.argv = process.argv.filter(a => a !== '--json');
}

const program = new Command();

program
  .name('instawp')
  .description('InstaWP CLI - Create and manage WordPress sites from the terminal')
  .version('0.1.0')
  .enablePositionalOptions()
  .option('--json', 'Output results as JSON');

registerLoginCommand(program);
registerWhoamiCommand(program);
registerSitesCommand(program);
registerCreateAlias(program);
registerWpCommand(program);
registerSyncCommand(program);

program.parse();
