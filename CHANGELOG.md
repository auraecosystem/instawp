# Changelog

## 0.0.1-beta.3 (2026-04-12)

### New Commands
- `local create` — Create local WordPress sites (powered by WordPress Playground, no Docker needed)
- `local clone <site>` — Clone an InstaWP cloud site to local (files + database)
- `local start/stop` — Start in foreground or `--background` mode
- `local push/pull` — Sync wp-content between local and cloud (incremental rsync)
- `local list` — Show local sites with running/stopped status
- `local delete` — Remove local sites
- `sites php <site>` — View or update PHP version and settings
- `sites update <site>` — Update site label, description, or expiration
- `teams switch <team>` — Switch active team context

### Improvements
- `create --wp <version>` — Specify WordPress version when creating sites
- `sites list` — 50 per page default, `--all` flag, pagination hints
- Login now shows user name and team after success
- Site resolver caches name-to-ID lookups for 10 minutes
- rsync only shows actually changed files (`--itemize-changes`)
- Magic login URL fixed to use correct `/wordpress-auto-login` endpoint

### Bug Fixes
- Windows: SSH key generation now works (removed Unix-specific shell commands)
- Windows: command detection uses `where` instead of `which`
- `exec/wp --api` flag now works at any position in the command
- Terminal restored after local site Ctrl+C (`stty sane`)

## 0.0.1-beta.2 (2026-03-23)

### New Commands
- `local create/clone/start/stop/push/pull/list/delete` — Full local development workflow
- `teams switch` — Client-side team context

### Improvements
- Site resolver caching
- Incremental rsync output

## 0.0.1-beta.1 (2026-03-02)

### Initial Release
- `login` — OAuth browser flow or `--token`
- `whoami` — Show current session
- `create` — Create WordPress sites with provisioning progress
- `sites list/delete` — Manage sites
- `exec/wp` — Run commands via SSH or API
- `ssh` — Interactive SSH sessions
- `sync push/pull` — rsync wp-content via SSH
- `teams list/members` — View teams
- `--json` mode for all commands
