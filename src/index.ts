#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { setJsonMode } from './lib/output.js';
import { registerLoginCommand } from './commands/login.js';
import { registerWhoamiCommand } from './commands/whoami.js';
import { registerSitesCommand, registerCreateAlias } from './commands/sites.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerSshCommand } from './commands/ssh.js';
import { registerExecCommand, registerWpCommand } from './commands/exec.js';
import { registerTeamsCommand } from './commands/teams.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

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
  .version(version)
  .enablePositionalOptions()
  .option('--json', 'Output results as JSON');

registerLoginCommand(program);
registerWhoamiCommand(program);
registerSitesCommand(program);
registerCreateAlias(program);
registerWpCommand(program);
registerSyncCommand(program);
registerSshCommand(program);
registerExecCommand(program);
registerTeamsCommand(program);

program.parse();
