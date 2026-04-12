#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import chalk from 'chalk';
import { setJsonMode } from './lib/output.js';
import { registerLoginCommand } from './commands/login.js';
import { registerWhoamiCommand } from './commands/whoami.js';
import { registerSitesCommand, registerCreateAlias } from './commands/sites.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerSshCommand } from './commands/ssh.js';
import { registerExecCommand, registerWpCommand } from './commands/exec.js';
import { registerTeamsCommand } from './commands/teams.js';
import { registerLocalCommand } from './commands/local.js';

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

// -- Auth --
registerLoginCommand(program);
registerWhoamiCommand(program);

// -- Sites --
registerSitesCommand(program);
registerCreateAlias(program);

// -- Remote access --
registerExecCommand(program);
registerWpCommand(program);
registerSshCommand(program);
registerSyncCommand(program);

// -- Teams --
registerTeamsCommand(program);

// -- Local dev --
registerLocalCommand(program);

// Custom help layout
program.configureHelp({
  sortSubcommands: false,
  subcommandTerm: (cmd) => cmd.name() + ' ' + cmd.usage(),
});

program.addHelpText('after', () => {
  const d = chalk.dim;
  const c = chalk.cyan;
  return `
${d('Auth')}
  ${c('login')}              Authenticate with InstaWP (browser or --token)
  ${c('whoami')}             Show current session info

${d('Sites')}
  ${c('create')}             Create a new WordPress site
  ${c('sites list')}         List all sites
  ${c('sites php')}          View or update PHP version/settings
  ${c('sites delete')}       Delete a site

${d('Remote Access')}
  ${c('exec')}  ${d('<site>')} ${d('<cmd>')}  Run any command on a site (SSH default, --api)
  ${c('wp')}    ${d('<site>')} ${d('<args>')} WP-CLI shorthand (exec <site> wp <args>)
  ${c('ssh')}   ${d('<site>')}          Interactive SSH session
  ${c('sync')}  ${d('push|pull')}       Sync wp-content via rsync

${d('Local Development')}
  ${c('local create')}       Create and start a local WordPress site
  ${c('local clone')}        Clone an InstaWP cloud site to local
  ${c('local start')}        Start an existing local site
  ${c('local stop')}         Stop a background local site
  ${c('local push')}         Push local wp-content to InstaWP cloud
  ${c('local pull')}         Pull cloud wp-content to local site
  ${c('local list')}         List local sites
  ${c('local delete')}       Delete a local site

${d('Teams')}
  ${c('teams list')}         List teams
  ${c('teams switch')}       Switch active team
  ${c('teams members')}      List team members

${d('Examples')}
  $ instawp login
  $ instawp create --name my-site
  $ instawp local create --name blog
  $ instawp wp my-site plugin list
  $ instawp exec my-site php -v --api
  $ instawp ssh my-site
  $ instawp sites list --json
`;
});

// Override default help to only show options (commands are in custom section)
program.configureHelp({
  sortSubcommands: false,
  formatHelp: (cmd, helper) => {
    const title = helper.padWidth(cmd, helper);
    const desc = cmd.description();
    const ver = cmd.version() ? `v${cmd.version()}` : '';

    let output = '';
    output += `${desc}${ver ? '  ' + chalk.dim(ver) : ''}\n\n`;
    output += `${chalk.dim('Usage:')} ${cmd.name()} [options] [command]\n`;

    const opts = helper.visibleOptions(cmd);
    if (opts.length) {
      output += `\n${chalk.dim('Options')}\n`;
      for (const opt of opts) {
        const flags = opt.flags;
        const desc = opt.description;
        output += `  ${flags.padEnd(30)} ${desc}\n`;
      }
    }

    return output;
  },
});

program.parse();
