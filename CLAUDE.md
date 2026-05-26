# CLAUDE.md - InstaWP CLI

## Overview

TypeScript CLI for InstaWP. Lets users create/manage WordPress sites from the terminal.

- **Stack**: TypeScript, ESM, Commander.js, Axios, Node 18+
- **Package**: `@instawp/cli` on npm (scoped, public)
- **Entry**: `src/index.ts` → compiled to `dist/index.js`
- **Binary**: `instawp` (registered via `bin` in package.json)

## Project Structure

```
src/
├── index.ts                 # CLI entry point, command registration
├── types.ts                 # All TypeScript interfaces
├── commands/
│   ├── login.ts             # OAuth browser flow + --token
│   ├── whoami.ts            # Show current session
│   ├── sites.ts             # sites list/create/delete + top-level create alias
│   ├── exec.ts              # exec + wp commands (merged, --api/--ssh transport)
│   ├── ssh.ts               # Interactive SSH shell
│   ├── sync.ts              # rsync push/pull via SSH
│   ├── teams.ts             # teams list/switch/members
│   └── local.ts             # local create/clone/start/stop/push/pull/list/delete
├── lib/
│   ├── api.ts               # Axios client, auth interceptor, team_id injection
│   ├── auth.ts              # OAuth flow (local HTTP server for callback)
│   ├── config.ts            # Conf-based persistent config (~/.config/instawp/)
│   ├── local-env.ts         # Playground server management, background mode
│   ├── output.ts            # chalk/ora output helpers, --json mode
│   ├── site-resolver.ts     # Resolve site by ID/name/domain with caching
│   ├── ssh-keys.ts          # SSH key generation, upload, caching
│   └── ssh-connection.ts    # SSH/rsync spawn helpers
├── __tests__/               # Vitest tests (148 tests)
scripts/
└── mysql2sqlite             # MySQL→SQLite dump converter (vendored)
```

## Commands

```
# Auth
instawp login [--token <t>] [--api-url <url>]
instawp whoami

# Sites (cloud)
instawp sites list [--status <s>] [--page <n>] [--per-page <n>] [--all]
instawp sites creds <site>
instawp create --name <n> [--php <v>] [--config <id>]
instawp sites delete <site> [--force]
instawp open <site> [--admin] [--magic] [--print]

# Remote access (wp is the primary command; exec is the escape hatch)
instawp wp <site> <args...> [--api]           # WP-CLI on the site
instawp ssh <site>                            # Interactive shell
instawp sync push <site> [--path] [--exclude] [--dry-run]
instawp sync pull <site> [--path] [--exclude] [--dry-run]
instawp db push <site> <file> [--force] [--no-backup]
instawp db pull <site> [--output <path>] [--no-compress]
instawp logs <site> [--wp] [--php] [--nginx] [--follow] [--lines <n>]
instawp exec <site> <cmd...> [--api] [--timeout <s>]   # Raw shell (non-WP)

# Teams
instawp teams list
instawp teams switch [team]          # client-side team context
instawp teams members <team>

# Local development (powered by WordPress Playground)
instawp local create [--name <n>] [--wp <v>] [--php <v>] [--background] [--no-open]
instawp local clone <cloud-site> [--name <n>] [--no-start]
instawp local start [name] [--background] [--no-open]
instawp local stop [name]
instawp local push <local-name> [cloud-site] [--dry-run]
instawp local pull <local-name> <cloud-site> [--dry-run]
instawp local list
instawp local delete <name> [--force]
```

All commands support `--json` for machine-readable output.

## Key Design Decisions

### wp (primary) + exec (escape hatch)
- **`wp <site>`** is the canonical way to run anything on a remote site — prepends `wp` to args, integrates with WP-CLI.
- **`exec <site>`** is the escape hatch for non-WP shell commands (`ls`, `tail`, `ps`, …). Same transport, no `wp` prefix.
- Both accept `--` as a POSIX end-of-options marker so users can forward raw args: `instawp wp my-site -- post list --post_type=page`
- Both shell-escape each arg via single-quote wrapping before piping to remote stdin — fixes the `eval '...'` parens issue.
- `--ssh` (default): real SSH connection, proper exit codes, real-time output
- `--api`: uses `POST /sites/{id}/run-cmd` API → cloud-app → InstaCP `v-instawp-run-cmd`
- Both transports can run arbitrary commands (API is not WP-only despite the name)

### Site resolution + caching
- `resolveSite()` accepts ID (numeric), name, or domain
- Numeric → direct `GET /sites/{id}/details`
- String → fetches list, matches by name/sub_domain/domain, then fetches details
- **Caches** name→ID mappings for 10 minutes (avoids list call on repeat lookups)

### Team context
- `teams switch` stores team_id locally (no server-side change)
- API interceptor injects `team_id` as query param on all requests
- Client-app `SiteService::getList()` already accepts `team_id` parameter

### Local development architecture
- Uses **WordPress Playground** (`@wp-playground/cli`) — WASM PHP + SQLite, no Docker needed
- NOT a hard dependency — auto-downloaded via `npx`, faster if installed globally (`npm i -g @wp-playground/cli`)
- Instance data stored at `~/.instawp/local/<name>/`
- Fresh sites: mount entire `wp-content` before install (`--mount-before-install`)
- Cloned sites: mount subdirs individually after install (`--mount`) so Playground sets up `db.php` internally

### Clone flow (local clone)
1. Export MySQL dump via SSH (`wp db export`)
2. Strip SSH MOTD from dump output
3. Convert MySQL → SQLite using `mysql2sqlite` (awk script)
4. Import directly into `.ht.sqlite` via `sqlite3` CLI
5. Rename table prefix to `wp_` (tables + meta keys + option names)
6. Search-replace cloud URL → `http://127.0.0.1:<port>` across all tables
7. Pull wp-content via rsync (plugins, themes, uploads)
8. Pull non-core root files (CLAUDE.md, .htaccess, etc.)
9. Generate blueprint with `WP_SQLITE_AST_DRIVER=true` + `login` step with actual admin username
10. Write error suppression mu-plugin

### Background mode
- `--background` flag spawns detached process, polls until server responds, returns immediately
- PID stored at `<instance>/server.pid`, logs at `<instance>/server.log`
- `local stop` kills the background process
- `local list` shows `running`/`stopped` status

### SSH key management
- Auto-generates RSA 4096 key at `~/.instawp/cli_key` if needed
- Checks existing keys (`~/.ssh/id_rsa`, `id_ed25519`) first
- Uploads to InstaWP API, enables SSH+SFTP on site, attaches key
- Caches connection details for 1 hour in conf store

### Config storage
- Uses `conf` package → `~/.config/instawp/config.json`
- Env overrides: `INSTAWP_TOKEN`, `INSTAWP_API_URL`
- Stores: auth, SSH cache, site cache, team_id, local instances

## Vendored Dependencies

### `scripts/mysql2sqlite`
- **Source**: https://github.com/dumblob/mysql2sqlite
- **License**: MIT
- **What**: AWK script that converts MySQL dump files to SQLite-compatible SQL
- **Used by**: `local clone` for database import
- **Version**: Vendored from master branch (2026-03-23)
- **Update procedure**: Download latest from `https://raw.githubusercontent.com/dumblob/mysql2sqlite/master/mysql2sqlite` and replace `scripts/mysql2sqlite`. Test with `instawp local clone` on a WooCommerce site to verify compatibility.

## Windows Support

Windows ships with `ssh`/`scp` but not `rsync`, `awk`, or `sqlite3`. The CLI works on Windows with zero extra installs via:

- **`better-sqlite3`** (npm dep) — replaces the sqlite3 CLI. Native module, prebuilt binaries for win32-x64.
- **`vendor/win32/busybox.exe`** — provides `awk` for the `mysql2sqlite` script (invoked as `busybox awk -f ...`). Statically linked, no DLLs. This is the **only** bundled binary.
- **Pure-JS SFTP** (`ssh2-sftp-client`) for file transfers — see below.
- **`cross-spawn`** for launching WordPress Playground (`local create/start/clone`). `npx`/`wp-playground-cli` are `.cmd` shims on Windows; Node won't spawn `.cmd` without `shell:true` (CVE-2024-27980), so `local-env.ts` uses `cross-spawn` (resolves the shim + quotes mount-path args safely). Never use bare `child_process.spawn` for npx/.cmd on Windows.

### File transfer: rsync (mac/Linux) vs SFTP (Windows)
- `syncFiles()` in `src/lib/ssh-connection.ts` is the dispatcher. On macOS/Linux it shells out to `rsync` (delta sync). On Windows it calls `syncViaSftp()` (`src/lib/sftp-sync.ts`).
- **Why not bundle rsync on Windows?** We tried (betas 4–9). msys2 rsync.exe cannot drive **native Windows OpenSSH** — incompatible pipe/signal semantics produce `connection unexpectedly closed (0 bytes)` + `sigpacket: Suppressing signal 30`. Bundling an msys ssh too would drag in the whole Heimdal/Kerberos DLL chain (~3.5 MB, ~15 brittle DLLs). Pure-JS SFTP sidesteps all of it.
- **Trade-off**: SFTP does full-file copy (no rsync delta). Fine for wp-content; slower on large repeat syncs.
- `syncViaSftp` mirrors rsync's exclude/include patterns via `makeMatcher` (exact names match at any depth; `*` globs don't cross `/`; patterns with `/` are anchored to the relative path).

### Resolution order (busybox)
- `findAwk()` (`src/commands/local.ts`) prefers bundled `busybox.exe` on Windows, then `awk`/`gawk` in PATH, then common Git-for-Windows dirs.
- `bundledBusybox()` (`src/lib/windows-binaries.ts`) returns the path only on win32 when the file exists.

### Refreshing the Windows bundle
```bash
# Maintainer-only — just downloads busybox64u.exe (requires curl)
bash scripts/fetch-windows-binaries.sh
git add vendor/win32 && git commit -m 'chore: refresh busybox'
```
See `vendor/win32/NOTICE.md` for source + license (BusyBox is GPL-2.0).

### Cross-platform path handling (rsync path, mac/Linux only)
- `src/lib/paths.ts` → `toRsyncPath()` converts `C:\foo\bar` → `/c/foo/bar`. Retained for completeness, but only exercised by `rsyncViaSsh` which no longer runs on Windows.

## Known Limitations

### Local clone + SQLite
- **WP_SQLITE_AST_DRIVER=true** is required for complex plugins (WooCommerce). The new AST-based SQLite driver (v2.2.1+) handles 99% of MySQL queries.
- Some MySQL-specific queries may still fail at runtime (rare edge cases in complex plugins)
- PHP deprecation warnings can crash WASM PHP — suppressed via mu-plugin (`error_reporting(E_ERROR | E_PARSE)`)
- `downloads.w.org` is unreachable on some networks — connectivity pre-check warns the user

## API Endpoints Used

| Endpoint | Used By |
|----------|---------|
| `GET /api/v2/sites` | sites list, site resolver |
| `GET /api/v2/sites/{id}/details` | site resolver |
| `POST /api/v2/sites` | sites create, local push (auto-create) |
| `DELETE /api/v2/sites/{id}` | sites delete |
| `POST /api/v2/sites/{id}/run-cmd` | exec --api, wp --api |
| `GET /api/v2/tasks/{id}/status` | create (poll provisioning) |
| `GET /api/v2/ssh-keys` | SSH key matching |
| `POST /api/v2/ssh-keys` | SSH key upload |
| `POST /api/v2/sites/{id}/ssh-keys/{keyId}` | attach key to site |
| `POST /api/v2/sites/{id}/update-ssh-status` | enable SSH |
| `POST /api/v2/sites/{id}/update-sftp-status` | enable SFTP |
| `GET /api/v2/teams` | teams list, whoami |
| `GET /api/v2/teams/{id}/members` | teams members |

## Development

```bash
npm install          # Install deps
npm run dev          # Watch mode (tsc --watch)
npm run build        # Build to dist/
npm test             # Run vitest (148 tests)
npm run test:watch   # Watch mode tests
```

### Testing locally
```bash
npm run build
node dist/index.js --help
node dist/index.js login --token <test-token>
node dist/index.js sites list
node dist/index.js local create --name test --background --no-open
node dist/index.js local stop test
```

Or link globally:
```bash
npm link
instawp --help
```

## Publishing

**Workflow**: Push a `v*` tag → GitHub Actions builds, tests, publishes to npm.

```bash
# Bump version in package.json, then:
git tag v0.0.1-beta.2
git push origin v0.0.1-beta.2
```

- Publishes with `--tag beta` (install via `npm i -g @instawp/cli@beta`)
- Uses `NPM_TOKEN` secret (generated from vikas@instawp.com npm account)
- Remove `--tag beta` from workflow for stable releases

## Conventions

- All imports use `.js` extension (ESM requirement)
- `process.exit(1)` on fatal errors after printing message via `error()`
- Spinners stop before printing output (no interleaved text)
- JSON mode returns `{ success, data }` or `{ success: false, error }`
- Version reads from package.json at runtime (single source of truth)
- rsync uses `--itemize-changes` (only shows actually changed files)
- Terminal restored with `stty sane` after Playground exits
